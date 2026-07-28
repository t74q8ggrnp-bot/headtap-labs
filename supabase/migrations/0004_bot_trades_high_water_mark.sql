-- Adds trailing-stop support to the paper trading bot: tracks each
-- position's peak price since entry so the exit logic can trail behind
-- it instead of selling at a single fixed target computed once at entry.
alter table bot_trades add column if not exists high_water_mark real;
