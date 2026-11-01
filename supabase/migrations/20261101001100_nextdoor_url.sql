-- Nextdoor is a meaningful channel for a neighbourhood home kitchen, so it
-- gets a field of its own rather than being squeezed into another link.

alter table settings add column nextdoor_url text;

grant select (nextdoor_url) on settings to anon, authenticated;
