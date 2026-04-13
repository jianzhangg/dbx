#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-dbx-smoke}"
INIT_CONFIG_PATH="$(mktemp /tmp/dbx-init.XXXXXX.yml)"
CONFIG_PATH="$(mktemp /tmp/dbx-docker.XXXXXX.yml)"
DBX=(node "$REPO_ROOT/dist/index.js")
MYSQL_CONTAINER="${COMPOSE_PROJECT}-mysql"
REDIS_CONTAINER="${COMPOSE_PROJECT}-redis"
MYSQL_TARGET=""
DOCKER_MODE="plain"
COMPOSE=()

cleanup() {
  rm -f "$INIT_CONFIG_PATH" "$CONFIG_PATH"
  if [[ "${KEEP_SERVICES:-0}" != "1" ]]; then
    if [[ "$DOCKER_MODE" == "compose" ]]; then
      "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
    else
      docker rm -f "$MYSQL_CONTAINER" "$REDIS_CONTAINER" >/dev/null 2>&1 || true
    fi
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"

  if [[ "$haystack" != *"$needle"* ]]; then
    echo "[FAIL] $label"
    echo "$haystack"
    exit 1
  fi
}

run_capture() {
  local __output_var="$1"
  local __status_var="$2"
  shift 2

  local output
  local status

  set +e
  output="$("${DBX[@]}" "$@" 2>&1)"
  status=$?
  set -e

  printf -v "$__output_var" "%s" "$output"
  printf -v "$__status_var" "%s" "$status"
}

mysql_exec() {
  local sql="$1"
  docker exec "$MYSQL_TARGET" env MYSQL_PWD=rootpwd mysql -uroot -D app -N -s -e "$sql"
}

count_processlist_query() {
  local sql="$1"
  mysql_exec "SELECT COUNT(*) FROM information_schema.processlist WHERE INFO = '$sql'"
}

wait_for_query_presence() {
  local sql="$1"

  for _ in $(seq 1 50); do
    if [[ "$(count_processlist_query "$sql")" -gt 0 ]]; then
      return
    fi
    sleep 0.1
  done

  echo "[FAIL] query did not appear in processlist: $sql"
  exit 1
}

wait_for_query_absence() {
  local sql="$1"

  for _ in $(seq 1 60); do
    if [[ "$(count_processlist_query "$sql")" -eq 0 ]]; then
      return
    fi
    sleep 0.1
  done

  echo "[FAIL] query did not disappear from processlist in time: $sql"
  exit 1
}

wait_for_pid_exit() {
  local pid="$1"
  local label="$2"

  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return
    fi
    sleep 0.1
  done

  echo "[FAIL] $label process did not exit in time"
  kill -9 "$pid" >/dev/null 2>&1 || true
  exit 1
}

detect_docker_mode() {
  if docker compose version >/dev/null 2>&1; then
    DOCKER_MODE="compose"
    COMPOSE=(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT")
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    DOCKER_MODE="compose"
    COMPOSE=(docker-compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT")
    return
  fi
}

wait_for_health() {
  local container_id="$1"
  local label="$2"
  local status=""

  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      return
    fi
    sleep 2
  done

  echo "[FAIL] $label did not become healthy"
  docker logs "$container_id" 2>/dev/null || true
  exit 1
}

start_services() {
  detect_docker_mode

  if [[ "$DOCKER_MODE" == "compose" ]]; then
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
    "${COMPOSE[@]}" up -d >/dev/null
    MYSQL_TARGET="$("${COMPOSE[@]}" ps -q mysql)"
    wait_for_health "$MYSQL_TARGET" "mysql"
    wait_for_health "$("${COMPOSE[@]}" ps -q redis)" "redis"
    return
  fi

  docker rm -f "$MYSQL_CONTAINER" "$REDIS_CONTAINER" >/dev/null 2>&1 || true

  docker run -d \
    --name "$MYSQL_CONTAINER" \
    -e MYSQL_ROOT_PASSWORD=rootpwd \
    -e MYSQL_DATABASE=app \
    -p 13307:3306 \
    --health-cmd "MYSQL_PWD=rootpwd mysqladmin ping -h 127.0.0.1 --silent" \
    --health-interval 3s \
    --health-timeout 3s \
    --health-retries 20 \
    --health-start-period 15s \
    mysql:8.4 >/dev/null

  docker run -d \
    --name "$REDIS_CONTAINER" \
    -p 16380:6379 \
    --health-cmd "redis-cli ping" \
    --health-interval 3s \
    --health-timeout 3s \
    --health-retries 20 \
    --health-start-period 5s \
    redis:7-alpine >/dev/null

  MYSQL_TARGET="$MYSQL_CONTAINER"
  wait_for_health "$MYSQL_CONTAINER" "mysql"
  wait_for_health "$REDIS_CONTAINER" "redis"
}

trap cleanup EXIT

cd "$REPO_ROOT"

echo "[1/6] Building dbx"
npm run build >/dev/null

echo "[2/6] Starting Docker services"
start_services

echo "[3/6] Verifying config initialization"
rm -f "$INIT_CONFIG_PATH"
run_capture init_output init_status --config "$INIT_CONFIG_PATH" config
if [[ "$init_status" -ne 0 ]]; then
  echo "$init_output"
  exit "$init_status"
fi
assert_contains "$init_output" '"created": true' "config should create a missing file"
assert_contains "$init_output" '"configPath":' "config should print the config path"

cat >"$CONFIG_PATH" <<'EOF'
profiles:
  mysql_ro:
    kind: mysql
    host: 127.0.0.1
    port: 13307
    user: root
    password: rootpwd
    database: app
    readonly: true
    timeout: 10

  mysql_timeout:
    kind: mysql
    host: 127.0.0.1
    port: 13307
    user: root
    password: rootpwd
    database: app
    readonly: true
    timeout: 1

  mysql_timeout_process:
    kind: mysql
    host: 127.0.0.1
    port: 13307
    user: root
    password: rootpwd
    database: app
    readonly: true
    timeout: 2

  mysql_rw:
    kind: mysql
    host: 127.0.0.1
    port: 13307
    user: root
    password: rootpwd
    database: app
    readonly: false
    timeout: 10

  redis_ro:
    kind: redis
    url: redis://127.0.0.1:16380/0
    readonly: true
    timeout: 10

  redis_rw:
    kind: redis
    url: redis://127.0.0.1:16380/0
    readonly: false
    timeout: 10
EOF

echo "[4/6] Verifying profile and ping commands"
run_capture list_output list_status --config "$CONFIG_PATH" profile list
if [[ "$list_status" -ne 0 ]]; then
  echo "$list_output"
  exit "$list_status"
fi
assert_contains "$list_output" '"name": "mysql_ro"' "profile list should include mysql_ro"
assert_contains "$list_output" '"name": "redis_rw"' "profile list should include redis_rw"

run_capture show_output show_status --config "$CONFIG_PATH" profile show mysql_rw
if [[ "$show_status" -ne 0 ]]; then
  echo "$show_output"
  exit "$show_status"
fi
assert_contains "$show_output" '"password": "***"' "profile show should redact the MySQL password"

run_capture mysql_ping_output mysql_ping_status --config "$CONFIG_PATH" ping mysql_ro
if [[ "$mysql_ping_status" -ne 0 ]]; then
  echo "$mysql_ping_output"
  exit "$mysql_ping_status"
fi
assert_contains "$mysql_ping_output" '"ping": "pong"' "mysql ping should succeed"

run_capture redis_ping_output redis_ping_status --config "$CONFIG_PATH" ping redis_ro
if [[ "$redis_ping_status" -ne 0 ]]; then
  echo "$redis_ping_output"
  exit "$redis_ping_status"
fi
assert_contains "$redis_ping_output" '"result": "PONG"' "redis ping should succeed"

echo "[5/6] Verifying MySQL and Redis read/write behavior"
run_capture mysql_timeout_var_output mysql_timeout_var_status --config "$CONFIG_PATH" sql mysql_timeout "SELECT @@max_execution_time AS timeout_ms"
if [[ "$mysql_timeout_var_status" -ne 0 ]]; then
  echo "$mysql_timeout_var_output"
  exit "$mysql_timeout_var_status"
fi
assert_contains "$mysql_timeout_var_output" '"timeout_ms": 1000' "mysql timeout profile should set session max_execution_time"

run_capture mysql_timeout_output mysql_timeout_status --config "$CONFIG_PATH" sql mysql_timeout "SELECT SLEEP(2) AS slept"
if [[ "$mysql_timeout_status" -ne 4 ]]; then
  echo "$mysql_timeout_output"
  exit 1
fi
assert_contains "$mysql_timeout_output" '"code": "TIMEOUT"' "mysql slow query should timeout"

run_capture mysql_timeout_cte_output mysql_timeout_cte_status --config "$CONFIG_PATH" sql mysql_timeout "WITH timeout_cte AS (SELECT SLEEP(2) AS slept) SELECT slept FROM timeout_cte"
if [[ "$mysql_timeout_cte_status" -ne 4 ]]; then
  echo "$mysql_timeout_cte_output"
  exit 1
fi
assert_contains "$mysql_timeout_cte_output" '"code": "TIMEOUT"' "mysql CTE query should timeout"

kill_query_sql="SELECT /* dbx_timeout_kill */ SLEEP(10) AS slept"
kill_query_output="$(mktemp /tmp/dbx-kill-output.XXXXXX)"
"${DBX[@]}" --config "$CONFIG_PATH" sql mysql_timeout_process "$kill_query_sql" >"$kill_query_output" 2>&1 &
kill_query_pid=$!
wait_for_query_presence "$kill_query_sql"
kill -9 "$kill_query_pid" >/dev/null 2>&1 || true
wait_for_query_absence "$kill_query_sql"
set +e
wait "$kill_query_pid" 2>/dev/null
set -e
rm -f "$kill_query_output"

hang_query_sql="SELECT /* dbx_timeout_stop */ SLEEP(10) AS slept"
hang_query_output="$(mktemp /tmp/dbx-stop-output.XXXXXX)"
"${DBX[@]}" --config "$CONFIG_PATH" sql mysql_timeout_process "$hang_query_sql" >"$hang_query_output" 2>&1 &
hang_query_pid=$!
wait_for_query_presence "$hang_query_sql"
kill -STOP "$hang_query_pid" >/dev/null 2>&1 || true
wait_for_query_absence "$hang_query_sql"
kill -CONT "$hang_query_pid" >/dev/null 2>&1 || true
wait_for_pid_exit "$hang_query_pid" "stopped dbx"
set +e
wait "$hang_query_pid" 2>/dev/null
hang_query_status=$?
set -e
if [[ "$hang_query_status" -ne 4 ]]; then
  cat "$hang_query_output"
  exit 1
fi
assert_contains "$(cat "$hang_query_output")" '"code": "TIMEOUT"' "stopped dbx query should still time out"
rm -f "$hang_query_output"

run_capture drop_output drop_status --config "$CONFIG_PATH" sql mysql_rw "DROP TABLE IF EXISTS dbx_cli_test"
if [[ "$drop_status" -ne 0 ]]; then
  echo "$drop_output"
  exit "$drop_status"
fi

run_capture create_output create_status --config "$CONFIG_PATH" sql mysql_rw "CREATE TABLE dbx_cli_test (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(64) NOT NULL, score INT NOT NULL)"
if [[ "$create_status" -ne 0 ]]; then
  echo "$create_output"
  exit "$create_status"
fi

run_capture insert_output insert_status --config "$CONFIG_PATH" sql mysql_rw "INSERT INTO dbx_cli_test (name, score) VALUES ('alice', 10)"
if [[ "$insert_status" -ne 0 ]]; then
  echo "$insert_output"
  exit "$insert_status"
fi
assert_contains "$insert_output" '"affectedRows": 1' "mysql write should affect one row"

run_capture select_output select_status --config "$CONFIG_PATH" sql mysql_ro "SELECT id, name, score FROM dbx_cli_test ORDER BY id"
if [[ "$select_status" -ne 0 ]]; then
  echo "$select_output"
  exit "$select_status"
fi
assert_contains "$select_output" '"name": "alice"' "mysql readonly query should return seeded data"

run_capture flush_output flush_status --config "$CONFIG_PATH" redis redis_rw FLUSHDB
if [[ "$flush_status" -ne 0 ]]; then
  echo "$flush_output"
  exit "$flush_status"
fi

run_capture redis_set_output redis_set_status --config "$CONFIG_PATH" redis redis_rw SET cli:key seeded
if [[ "$redis_set_status" -ne 0 ]]; then
  echo "$redis_set_output"
  exit "$redis_set_status"
fi
assert_contains "$redis_set_output" '"result": "OK"' "redis write should succeed"

run_capture redis_get_output redis_get_status --config "$CONFIG_PATH" redis redis_ro GET cli:key
if [[ "$redis_get_status" -ne 0 ]]; then
  echo "$redis_get_output"
  exit "$redis_get_status"
fi
assert_contains "$redis_get_output" '"result": "seeded"' "redis readonly query should return seeded data"

echo "[6/6] Verifying readonly protection"
run_capture mysql_block_output mysql_block_status --config "$CONFIG_PATH" sql mysql_ro "INSERT INTO dbx_cli_test (name, score) VALUES ('blocked', 99)"
if [[ "$mysql_block_status" -ne 3 ]]; then
  echo "$mysql_block_output"
  exit 1
fi
assert_contains "$mysql_block_output" '"code": "READONLY_BLOCKED"' "mysql readonly write should be blocked"

run_capture redis_block_output redis_block_status --config "$CONFIG_PATH" redis redis_ro SET cli:key blocked
if [[ "$redis_block_status" -ne 3 ]]; then
  echo "$redis_block_output"
  exit 1
fi
assert_contains "$redis_block_output" '"code": "READONLY_BLOCKED"' "redis readonly write should be blocked"

echo "[PASS] docker smoke test passed"
