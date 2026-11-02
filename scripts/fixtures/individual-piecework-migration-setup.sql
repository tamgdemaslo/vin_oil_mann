-- Disposable schema for the production membership-JSON representation.
CREATE TABLE users(id TEXT PRIMARY KEY,login TEXT,auth_role TEXT,status TEXT);
CREATE TABLE branch_memberships(id TEXT PRIMARY KEY,branch_id TEXT,user_id TEXT,pay_settings_json JSONB,status TEXT);
CREATE TABLE piecework_rules(id TEXT PRIMARY KEY,branch_id TEXT,target_type TEXT,target_id TEXT,target_name TEXT,role TEXT,mode TEXT,fixed_cents INT,percent_basis_points INT);
INSERT INTO users VALUES ('m','maksim','master','active'),('a','vadim','admin','active'),('custom','custom','master','active'),('retired','retired','master','active');
INSERT INTO branch_memberships VALUES ('m1','main','m','{"retainedSetting":123}','active'),('a1','main','a',NULL,'active'),('custom1','main','custom','{"individualPiecework":true,"pieceworkRules":[{"targetType":"all_services","targetId":"*","targetName":"Все услуги","mode":"fixed","fixedCents":2222,"percentBasisPoints":null}]}','active'),('retired1','main','retired','{"employmentEnd":"2026-10-20"}','disabled'),('m2','other','m',NULL,'active');
INSERT INTO piecework_rules VALUES ('s','main','service','svc','Услуга','master','fixed',1000,NULL),('p','main','product_group','grp','Группа','admin','percent',NULL,1000),('s2','other','service','svc','Услуга','master','fixed',2000,NULL);
