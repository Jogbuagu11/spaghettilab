-- The delivery origin shipped as a 95131 ZIP centroid, which sits 1.33 miles
-- from the actual kitchen at 1183 Benny Ct. With a 5-mile radius that skewed
-- the whole zone north-east: addresses just inside the real radius to the
-- south-west were refused, and ones outside it to the north-east accepted.
--
-- Corrected to the geocoded street address. The default is updated too, so a
-- fresh environment doesn't reintroduce the ZIP centroid.

alter table settings
  alter column origin_lat set default 37.373678,
  alter column origin_lng set default -121.880233;

update settings
set origin_lat = 37.373678,
    origin_lng = -121.880233
where id = 1
  and origin_lat = 37.385800
  and origin_lng = -121.861500;
