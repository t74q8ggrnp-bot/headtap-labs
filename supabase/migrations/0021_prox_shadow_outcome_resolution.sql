-- Honest, terminal resolution states for independent ProX shadow outcomes.
-- A horizon with no verified bar must never receive a fabricated zero return.

alter table public.prox_shadow_board_member_outcome_horizons
  add column if not exists resolution_state text,
  add column if not exists unavailable_reason text;

update public.prox_shadow_board_member_outcome_horizons
set resolution_state = case when complete then 'measured' else 'pending' end
where resolution_state is null;

-- A literal Friday +24h lands on Saturday, when no stock bar can exist.
-- Move still-pending weekend 24h observations to the next weekday at the
-- same UTC wall-clock. Next-session remains a separate 09:35 ET horizon.
update public.prox_shadow_board_member_outcome_horizons
set target_at = target_at +
  case extract(isodow from target_at)
    when 6 then interval '2 days'
    when 7 then interval '1 day'
    else interval '0 days'
  end
where horizon = '24h'
  and complete = false
  and extract(isodow from target_at) in (6, 7);

alter table public.prox_shadow_board_member_outcome_horizons
  alter column resolution_state set default 'pending',
  alter column resolution_state set not null;

alter table public.prox_shadow_board_member_outcome_horizons
  drop constraint if exists prox_shadow_board_member_outcome_horizons_check;

alter table public.prox_shadow_board_member_outcome_horizons
  drop constraint if exists prox_shadow_board_member_outcome_horizons_resolution_state_check;

alter table public.prox_shadow_board_member_outcome_horizons
  drop constraint if exists prox_shadow_board_member_outcome_horizons_resolution_check;

alter table public.prox_shadow_board_member_outcome_horizons
  add constraint prox_shadow_board_member_outcome_horizons_resolution_state_check
  check (resolution_state in ('pending', 'measured', 'unavailable'));

alter table public.prox_shadow_board_member_outcome_horizons
  add constraint prox_shadow_board_member_outcome_horizons_resolution_check
  check (
    (
      resolution_state = 'pending'
      and complete = false
      and measured_at is null
      and measured_price is null
      and return_percent is null
      and unavailable_reason is null
    )
    or
    (
      resolution_state = 'measured'
      and complete = true
      and measured_at is not null
      and measured_price > 0
      and return_percent is not null
      and unavailable_reason is null
    )
    or
    (
      resolution_state = 'unavailable'
      and complete = true
      and measured_at is null
      and measured_price is null
      and return_percent is null
      and unavailable_reason is not null
    )
  );

create index if not exists prox_shadow_board_horizon_resolution_idx
  on public.prox_shadow_board_member_outcome_horizons
  (resolution_state, target_at);

comment on column public.prox_shadow_board_member_outcome_horizons.resolution_state is
  'pending until resolved; measured only from a verified historical bar; unavailable is terminal and excluded from calibration.';
