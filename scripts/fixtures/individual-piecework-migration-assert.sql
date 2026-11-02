DO $$ BEGIN
 ASSERT (SELECT count(*) FROM piecework_rules)=0, 'Shared rules removed';
 ASSERT (SELECT count(*) FROM piecework_rules_shared_archive_20261103)=3, 'Shared rules archived';
 ASSERT (SELECT count(*) FROM employee_pay_settings_archive_20261103)=5, 'Original personal settings archived';
 ASSERT NOT EXISTS(SELECT 1 FROM branch_memberships WHERE coalesce((pay_settings_json->>'individualPiecework')::boolean,false)=false), 'Memberships use individual rules';
 ASSERT (SELECT pay_settings_json->>'retainedSetting' FROM branch_memberships WHERE id='m1')='123', 'Unrelated settings preserved';
 ASSERT (SELECT pay_settings_json->'pieceworkRules'->0->>'fixedCents' FROM branch_memberships WHERE id='m1')='1000', 'Master amount unchanged';
 ASSERT (SELECT pay_settings_json->'pieceworkRules'->0->>'fixedCents' FROM branch_memberships WHERE id='m2')='2000', 'Branch isolation preserved';
 ASSERT (SELECT pay_settings_json->'pieceworkRules'->0->>'percentBasisPoints' FROM branch_memberships WHERE id='a1')='1000', 'Admin percentage unchanged';
 ASSERT (SELECT pay_settings_json->'pieceworkRules'->0->>'fixedCents' FROM branch_memberships WHERE id='custom1')='2222', 'Explicit individual override preserved';
 ASSERT (SELECT pay_settings_json->>'employmentEnd' FROM branch_memberships WHERE id='retired1')='2026-10-20', 'Dismissal cutoff preserved';
END $$;
