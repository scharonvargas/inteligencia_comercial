-- ⚠️ WARNING: This will DELETE existing data in these tables. 
-- Use this to reset the schema to the correct state.

DROP TABLE IF EXISTS prospects CASCADE;
DROP TABLE IF EXISTS rate_limits CASCADE;

-- Create Prospects Table
CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  website TEXT,
  social_links JSONB DEFAULT '[]'::jsonb,
  last_activity_evidence TEXT,
  days_since_last_activity INTEGER,
  trust_score INTEGER,
  status TEXT,
  category TEXT,
  lat FLOAT,
  lng FLOAT,
  pipeline_stage TEXT DEFAULT 'new',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Create Rate Limits Table
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  search_count INTEGER DEFAULT 0,
  reset_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  UNIQUE(user_id, reset_date)
);

-- Create Indexes
CREATE INDEX idx_prospects_business_id ON prospects(business_id);
CREATE INDEX idx_prospects_pipeline_stage ON prospects(pipeline_stage);
CREATE INDEX idx_rate_limits_user_date ON rate_limits(user_id, reset_date);

-- Enable RLS
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Create Policies
CREATE POLICY "Allow public read access" ON prospects FOR SELECT USING (true);
CREATE POLICY "Allow public insert access" ON prospects FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access" ON prospects FOR UPDATE USING (true);
CREATE POLICY "Allow public delete access" ON prospects FOR DELETE USING (true);

CREATE POLICY "Allow public read access" ON rate_limits FOR SELECT USING (true);
CREATE POLICY "Allow public insert access" ON rate_limits FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access" ON rate_limits FOR UPDATE USING (true);

-- Check if tables exist
DO $$
BEGIN
    RAISE NOTICE 'Schema recreated successfully.';
END $$;
