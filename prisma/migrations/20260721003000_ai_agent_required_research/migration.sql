-- Complex technical servicing must have an actual web-search path by default.
ALTER TABLE ai_agent_settings
  ALTER COLUMN internet_search_enabled SET DEFAULT true;

UPDATE ai_agent_settings
SET internet_search_enabled = true
WHERE internet_search_enabled = false;
