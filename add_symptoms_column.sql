-- ============================================================
-- Swasthya Bandhu: Add 'symptoms' column to patient_data
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Add the symptoms column (TEXT, nullable — defaults to NULL)
ALTER TABLE patient_data 
ADD COLUMN IF NOT EXISTS symptoms TEXT DEFAULT NULL;

-- Verify the column was added:
SELECT id, symptoms FROM patient_data LIMIT 5;
