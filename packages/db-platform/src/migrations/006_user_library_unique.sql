-- 006: Add unique constraint to user_library to prevent duplicate entries
ALTER TABLE user_library ADD CONSTRAINT user_library_user_listing_unique UNIQUE(user_id, listing_id);
