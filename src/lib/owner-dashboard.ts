import { prisma } from "@/lib/db";
import type { BranchContext } from "@/lib/branch-context";

function startOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getOwnerDashboard(context: BranchContext) {
  if (!context.groupRole) throw new Error("owner_access_required");
  const monthStart = startOfMonth();
  const rows = await Promise.all(context.branches.map(async (branch) => {
    const [shipments, clients, vehicles, products, expenses, payroll, openCashShifts, overdueCases] = await Promise.all([
      prisma.localDemand.aggregate({
        where: { branchId: branch.id, applicable: true, momentAt: { gte: monthStart } },
        _count: { _all: true },
        _sum: { sumCents: true },
        _avg: { sumCents: true },
      }),
      prisma.localCounterparty.count({ where: { branchId: branch.id, archived: false } }),
      prisma.diagnosticMapSession.count({ where: { branchId: branch.id, vin: { not: null } } }),
      prisma.localProduct.count({ where: { branchId: branch.id, archived: false } }),
      prisma.cashExpenseOrder.aggregate({
        where: { branchId: branch.id, status: { not: "cancelled" }, createdAt: { gte: monthStart } },
        _sum: { amountCents: true },
      }),
      prisma.payrollPayment.aggregate({
        where: { branchId: branch.id, status: "ACTIVE", createdAt: { gte: monthStart } },
        _sum: { amountCents: true },
      }),
      prisma.cashShift.count({ where: { branchId: branch.id, status: "open" } }),
      prisma.crmDeal.count({
        where: { branchId: branch.id, status: "open", nextActionAt: { lt: new Date() } },
      }),
    ]);
    const revenueCents = shipments._sum.sumCents ?? 0;
    const expenseCents = expenses._sum.amountCents ?? 0;
    const payrollCents = payroll._sum.amountCents ?? 0;
    return {
      branch: { id: branch.id, name: branch.name, shortName: branch.shortName, displayName: branch.displayName, status: branch.status },
      revenueCents,
      shipmentsCount: shipments._count._all,
      averageCheckCents: Math.round(shipments._avg.sumCents ?? 0),
      clientsCount: clients,
      vehiclesCount: vehicles,
      productsCount: products,
      expensesCents: expenseCents,
      payrollCents,
      operatingResultCents: revenueCents - expenseCents - payrollCents,
      openCashShifts,
      overdueCases,
    };
  }));

  const total = rows.reduce((sum, row) => ({
    revenueCents: sum.revenueCents + row.revenueCents,
    shipmentsCount: sum.shipmentsCount + row.shipmentsCount,
    clientsCount: sum.clientsCount + row.clientsCount,
    vehiclesCount: sum.vehiclesCount + row.vehiclesCount,
    productsCount: sum.productsCount + row.productsCount,
    expensesCents: sum.expensesCents + row.expensesCents,
    payrollCents: sum.payrollCents + row.payrollCents,
    operatingResultCents: sum.operatingResultCents + row.operatingResultCents,
    openCashShifts: sum.openCashShifts + row.openCashShifts,
    overdueCases: sum.overdueCases + row.overdueCases,
  }), {
    revenueCents: 0,
    shipmentsCount: 0,
    clientsCount: 0,
    vehiclesCount: 0,
    productsCount: 0,
    expensesCents: 0,
    payrollCents: 0,
    operatingResultCents: 0,
    openCashShifts: 0,
    overdueCases: 0,
  });
  return {
    period: { from: monthStart.toISOString(), to: new Date().toISOString() },
    total: {
      ...total,
      averageCheckCents: total.shipmentsCount ? Math.round(total.revenueCents / total.shipmentsCount) : 0,
    },
    branches: rows,
  };
}
