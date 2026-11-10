-- The kitchen moved from Benny Ct in Berryessa to 82 E Santa Clara St downtown.
--
-- Both the pickup address and the delivery origin move together: the radius is
-- measured from wherever the food is actually made. Recentring 5 miles on
-- 95113 puts Milpitas out of range (6.6 mi, was 4.1) and brings Downtown,
-- Willow Glen and parts of Campbell in.
--
-- Coordinates geocoded from the street address, not the ZIP centroid — a
-- centroid was 1.33 miles off last time and quietly mispriced the radius check.

update settings
   set pickup_address     = '82 E Santa Clara St, San Jose, CA 95113',
       origin_postal_code = '95113',
       origin_lat         = 37.336826,
       origin_lng         = -121.888506
 where id = 1;
