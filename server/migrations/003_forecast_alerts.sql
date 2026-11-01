-- Opt-in alerts when a cyclone's forecast cone reaches an area, before its winds do
alter table areas add column forecast_alerts boolean not null default false;
