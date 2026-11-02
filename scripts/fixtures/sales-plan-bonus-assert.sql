DO $$ BEGIN
  ASSERT (SELECT target_count FROM branch_sales_plans WHERE id='existing-plan')=30;
  ASSERT (SELECT completion_bonus_cents IS NULL FROM branch_sales_plans WHERE id='existing-plan'), 'Existing plans must not receive an invented bonus';
END $$;
UPDATE branch_sales_plans SET completion_bonus_cents=500000 WHERE id='existing-plan';
DO $$ BEGIN
  ASSERT (SELECT completion_bonus_cents FROM branch_sales_plans WHERE id='existing-plan')=500000;
  BEGIN
    UPDATE branch_sales_plans SET completion_bonus_cents=-1;
    RAISE EXCEPTION 'Negative bonus was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
