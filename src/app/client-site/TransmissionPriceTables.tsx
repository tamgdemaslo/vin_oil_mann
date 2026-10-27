import { TRANSMISSION_PRICE_GROUPS, TRANSMISSION_PRICE_TERMS } from "@/lib/transmission-pricing";

const money = (amount: number) => `${amount.toLocaleString("ru-RU")} ₽`;

export default function TransmissionPriceTables() {
  return <div className="transmission-prices">
    {TRANSMISSION_PRICE_GROUPS.map(group => <section className="transmission-prices__method" key={group.method}>
      <h3>{group.title} масла в АКПП</h3>
      <p className="transmission-prices__branches">{group.branches}</p>
      <table className="transmission-prices__table">
        <caption className="sr-only">{group.title} масла в АКПП — стоимость работы</caption>
        <thead><tr>
          <th scope="col">Услуга</th>
          <th scope="col">С нашими материалами</th>
          <th scope="col">С вашими материалами</th>
        </tr></thead>
        <tbody>{group.rows.map(row => <tr key={row.filters}>
          <th scope="row">{row.label}</th>
          <td>{money(row.shop)}</td>
          <td>{money(row.customer)}</td>
        </tr>)}</tbody>
      </table>
    </section>)}
    <p className="transmission-prices__terms">{TRANSMISSION_PRICE_TERMS}</p>
  </div>;
}
