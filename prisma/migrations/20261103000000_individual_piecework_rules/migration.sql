BEGIN;
CREATE TABLE piecework_rules_shared_archive_20261103 AS TABLE piecework_rules;
CREATE TABLE employee_pay_settings_archive_20261103 AS SELECT id, branch_id, user_id, pay_settings_json FROM branch_memberships;
UPDATE branch_memberships m
SET pay_settings_json = coalesce(m.pay_settings_json, '{}'::jsonb) || jsonb_build_object(
  'individualPiecework', true,
  'pieceworkRules', coalesce((SELECT jsonb_agg(jsonb_build_object('targetType',r.target_type,'targetId',r.target_id,'targetName',r.target_name,'mode',r.mode,'fixedCents',r.fixed_cents,'percentBasisPoints',r.percent_basis_points) ORDER BY r.target_type,r.target_id)
   FROM piecework_rules r WHERE r.branch_id=m.branch_id AND r.role=u.auth_role), '[]'::jsonb))
FROM users u WHERE u.id=m.user_id
  AND coalesce((m.pay_settings_json->>'individualPiecework')::boolean,false)=false;
DELETE FROM piecework_rules;
COMMIT;
