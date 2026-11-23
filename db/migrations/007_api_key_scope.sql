-- Область ключа: 'brand' — работает только с брендом, где создан (как раньше);
-- 'all' — доступ ко всем брендам (для Claude: бренд выбирается параметром инструмента).
alter table api_keys add column scope text not null default 'brand' check (scope in ('brand', 'all'));
