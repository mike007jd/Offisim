ALTER TABLE package_versions
  ADD CONSTRAINT package_versions_listing_package_version_unique
  UNIQUE (listing_id, package_id, version);

ALTER TABLE listing_tags
  ADD CONSTRAINT listing_tags_listing_tag_unique
  UNIQUE (listing_id, tag);

ALTER TABLE reviews
  ADD CONSTRAINT reviews_listing_user_unique
  UNIQUE (listing_id, user_id);

ALTER TABLE user_library
  ADD CONSTRAINT user_library_user_listing_unique
  UNIQUE (user_id, listing_id);
