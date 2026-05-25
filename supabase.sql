create table if not exists public.chat_users (
  name text primary key,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.chat_contacts (
  user_name text not null references public.chat_users(name) on delete cascade,
  contact_name text not null references public.chat_users(name) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_name, contact_name),
  constraint chat_contacts_not_self check (user_name <> contact_name)
);

create table if not exists public.chat_groups (
  id text primary key,
  name text not null,
  creator text not null references public.chat_users(name) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_group_members (
  group_id text not null references public.chat_groups(id) on delete cascade,
  user_name text not null references public.chat_users(name) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_name)
);

create table if not exists public.chat_messages (
  id text primary key,
  scope text not null check (scope in ('privado', 'grupo')),
  sender text not null references public.chat_users(name) on delete cascade,
  recipient text references public.chat_users(name) on delete cascade,
  group_id text references public.chat_groups(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint chat_messages_target check (
    (scope = 'privado' and recipient is not null and group_id is null)
    or
    (scope = 'grupo' and recipient is null and group_id is not null)
  )
);

create table if not exists public.chat_message_receipts (
  message_id text not null references public.chat_messages(id) on delete cascade,
  user_name text not null references public.chat_users(name) on delete cascade,
  delivered boolean not null default false,
  read boolean not null default false,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_name)
);

create index if not exists chat_contacts_user_idx on public.chat_contacts(user_name);
create index if not exists chat_group_members_user_idx on public.chat_group_members(user_name);
create index if not exists chat_messages_sender_idx on public.chat_messages(sender);
create index if not exists chat_messages_recipient_idx on public.chat_messages(recipient);
create index if not exists chat_messages_group_idx on public.chat_messages(group_id);
create index if not exists chat_message_receipts_user_idx on public.chat_message_receipts(user_name);

alter table public.chat_users disable row level security;
alter table public.chat_contacts disable row level security;
alter table public.chat_groups disable row level security;
alter table public.chat_group_members disable row level security;
alter table public.chat_messages disable row level security;
alter table public.chat_message_receipts disable row level security;
