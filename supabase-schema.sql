-- Supabase PostgreSQL Schema & RPCs

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0.0
);

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  entry_fee NUMERIC NOT NULL
);

CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id),
  user_id UUID REFERENCES users(id),
  seat_index INT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(room_id, seat_index)
);

-- RPC for atomic ticket purchase with row-level lock
CREATE OR REPLACE FUNCTION purchase_ticket(p_user_id UUID, p_room_id UUID, p_seat_index INT, p_amount NUMERIC)
RETURNS BOOLEAN AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  -- Row-level lock on the user's balance to prevent double spending race conditions
  SELECT balance INTO v_balance FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Deduct balance
  UPDATE users SET balance = balance - p_amount WHERE id = p_user_id;

  -- Insert ticket (fails if seat_index is already taken due to UNIQUE constraint)
  INSERT INTO tickets (room_id, user_id, seat_index) VALUES (p_room_id, p_user_id, p_seat_index);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Enable Realtime for tickets table
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
