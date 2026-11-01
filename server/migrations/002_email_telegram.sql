-- Email and Telegram channels. One person may put the same email address or Telegram chat on several
-- subscriptions (phone and laptop), so an address is now unique per subscription. A browser's push
-- endpoint still belongs to one subscription only, and link tokens are unique.
alter table channels drop constraint channels_pkey;
alter table channels add primary key (subscription_id, kind, address);
create unique index channels_push_endpoint on channels (address) where kind = 'push';
create unique index channels_token on channels ((data ->> 'token')) where data ? 'token';
