DO $$ BEGIN
  ASSERT (SELECT target_value FROM payroll_goals WHERE id='legacy-goal')=10, 'Existing goal is preserved';
  ASSERT (SELECT target_id IS NULL FROM payroll_goals WHERE id='legacy-goal'), 'Legacy goal has no invented catalog association';
END $$;
INSERT INTO payroll_goals (id, metric, target_value, target_id, target_name)
VALUES ('catalog-goal', 'SERVICE', 20, 'service-id', 'Замена моторного масла');
DO $$ BEGIN
  ASSERT (SELECT target_id FROM payroll_goals WHERE id='catalog-goal')='service-id', 'Catalog ID persists';
  ASSERT (SELECT target_name FROM payroll_goals WHERE id='catalog-goal')='Замена моторного масла', 'Display name persists';
END $$;
