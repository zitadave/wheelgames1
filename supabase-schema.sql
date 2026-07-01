-- Supabase Schema for the Game

-- Create the rounds table
CREATE TABLE IF NOT EXISTS rounds (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    round_number INTEGER NOT NULL,
    winner INTEGER,
    pools_even NUMERIC DEFAULT 0,
    pools_odd NUMERIC DEFAULT 0,
    room_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create the bets table
CREATE TABLE IF NOT EXISTS bets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    round_id UUID REFERENCES rounds(id),
    user_id TEXT NOT NULL,
    username TEXT,
    amount NUMERIC NOT NULL,
    side TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Note: You might want to enable RLS (Row Level Security) depending on your needs.
-- Since the backend uses the Service Role key, it bypasses RLS for inserting records.
