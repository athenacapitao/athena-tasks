#!/bin/bash
# P2-16: Integration test - Full API round-trip via curl
# This script tests the complete API lifecycle

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://127.0.0.1:7700}"
AUTH_TOKEN="${ATHENA_TASKS_TOKEN}"

# Helper: print test result
print_result() {
  local test_name="$1"
  local status="$2"
  local expected="$3"
  local actual="$4"

  if [ "$status" -eq "$expected" ]; then
    echo -e "${GREEN}✓${NC} $test_name"
  else
    echo -e "${RED}✗${NC} $test_name (expected $expected, got $status)"
    echo -e "${YELLOW}Response:${NC} $actual"
    exit 1
  fi
}

# Helper: HTTP request with status code
http_code() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

# Helper: HTTP response body
http_body() {
  curl -s "$@"
}

echo "======================================"
echo "Athena Tasks API Integration Test"
echo "======================================"
echo ""

# Test 1: Health check (no auth required)
echo "Test 1: Health check"
response=$(http_body "${API_URL}/api/health")
code=$(http_code "${API_URL}/api/health")
print_result "Health check" "$code" 200 "$response"
echo ""

# Test 2: Create task
echo "Test 2: Create task (POST /api/tasks)"
TASK_RESPONSE=$(http_body -X POST "${API_URL}/api/tasks" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Integration test task",
    "description": "Testing full API lifecycle",
    "priority": "high",
    "assigned_to": "athena",
    "tags": ["testing", "api"]
  }')
TASK_CODE=$(http_code -X POST "${API_URL}/api/tasks" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"test"}')
print_result "Create task" "$TASK_CODE" 201
TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.id')
echo "Created task ID: $TASK_ID"
echo ""

# Test 3: List tasks
echo "Test 3: List tasks (GET /api/tasks)"
LIST_RESPONSE=$(http_body "${API_URL}/api/tasks" \
  -H "Authorization: Bearer $AUTH_TOKEN")
LIST_CODE=$(http_code "${API_URL}/api/tasks" \
  -H "Authorization: Bearer $AUTH_TOKEN")
print_result "List tasks" "$LIST_CODE" 200
echo ""

# Test 4: Get single task
echo "Test 4: Get single task (GET /api/tasks/:id)"
GET_RESPONSE=$(http_body "${API_URL}/api/tasks/${TASK_ID}" \
  -H "Authorization: Bearer $AUTH_TOKEN")
GET_CODE=$(http_code "${API_URL}/api/tasks/${TASK_ID}" \
  -H "Authorization: Bearer $AUTH_TOKEN")
print_result "Get single task" "$GET_CODE" 200
echo ""

# Test 5: Update task
echo "Test 5: Update task (PATCH /api/tasks/:id)"
UPDATE_CODE=$(http_code -X PATCH "${API_URL}/api/tasks/${TASK_ID}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}')
print_result "Update task to in_progress" "$UPDATE_CODE" 200
echo ""

# Test 6: Add subtask
echo "Test 6: Add subtask (POST /api/tasks/:id/subtasks)"
SUBTASK_RESPONSE=$(http_body -X POST "${API_URL}/api/tasks/${TASK_ID}/subtasks" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test subtask 1"}')
SUBTASK_CODE=$(http_code -X POST "${API_URL}/api/tasks/${TASK_ID}/subtasks" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"test"}')
print_result "Add subtask" "$SUBTASK_CODE" 201
SUBTASK1_ID=$(echo "$SUBTASK_RESPONSE" | jq -r '.id')
echo "Created subtask ID: $SUBTASK1_ID"
echo ""

# Test 7: Add second subtask
echo "Test 7: Add second subtask"
SUBTASK2_CODE=$(http_code -X POST "${API_URL}/api/tasks/${TASK_ID}/subtasks" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test subtask 2"}')
print_result "Add second subtask" "$SUBTASK2_CODE" 201
echo ""

# Test 8: Toggle subtask
echo "Test 8: Toggle subtask (PATCH /api/tasks/:id/subtasks/:stid)"
TOGGLE_CODE=$(http_code -X PATCH "${API_URL}/api/tasks/${TASK_ID}/subtasks/${SUBTASK1_ID}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"done":true}')
print_result "Toggle subtask" "$TOGGLE_CODE" 200
echo ""

# Test 9: Add comment
echo "Test 9: Add comment (POST /api/tasks/:id/activity)"
COMMENT_CODE=$(http_code -X POST "${API_URL}/api/tasks/${TASK_ID}/activity" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"by":"athena","action":"comment","detail":"Integration test in progress"}')
print_result "Add comment" "$COMMENT_CODE" 200
echo ""

# Test 10: Verify task
echo "Test 10: Verify task (POST /api/tasks/:id/verify)"
VERIFY_CODE=$(http_code -X POST "${API_URL}/api/tasks/${TASK_ID}/verify" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verified":true,"notes":"All tests passing"}')
print_result "Verify task" "$VERIFY_CODE" 200
echo ""

# Test 11: Complete task
echo "Test 11: Complete task (POST /api/tasks/:id/complete)"
COMPLETE_CODE=$(http_code -X POST "${API_URL}/api/tasks/${TASK_ID}/complete" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "summary":"Integration test completed successfully",
    "files_changed":[],
    "time_spent_minutes":5,
    "verified":true
  }')
print_result "Complete task" "$COMPLETE_CODE" 200
echo ""

# Test 12: Reopen task
echo "Test 12: Reopen task (POST /api/tasks/:id/reopen)"
REOPEN_CODE=$(http_code -X POST "${API_URL}/api/tasks/${TASK_ID}/reopen" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Testing reopen endpoint"}')
print_result "Reopen task" "$REOPEN_CODE" 200
echo ""

# Test 13: Delete subtask
echo "Test 13: Delete subtask (DELETE /api/tasks/:id/subtasks/:stid)"
DELETE_SUBTASK_CODE=$(http_code -X DELETE "${API_URL}/api/tasks/${TASK_ID}/subtasks/${SUBTASK1_ID}" \
  -H "Authorization: Bearer $AUTH_TOKEN")
print_result "Delete subtask" "$DELETE_SUBTASK_CODE" 200
echo ""

# Test 14: Delete task (soft delete)
echo "Test 14: Delete task (DELETE /api/tasks/:id)"
DELETE_CODE=$(http_code -X DELETE "${API_URL}/api/tasks/${TASK_ID}" \
  -H "Authorization: Bearer $AUTH_TOKEN")
print_result "Delete task (soft delete)" "$DELETE_CODE" 200
echo ""

# Test 15: Get projects
echo "Test 15: Get projects (GET /api/projects)"
PROJECTS_CODE=$(http_code "${API_URL}/api/projects" \
  -H "Authorization: Bearer $AUTH_TOKEN")
print_result "Get projects" "$PROJECTS_CODE" 200
echo ""

# Test 16: Get dashboard
echo "Test 16: Get dashboard (GET /api/dashboard)"
DASHBOARD_CODE=$(http_code "${API_URL}/api/dashboard" \
  -H "Authorization: Bearer $AUTH_TOKEN")
print_result "Get dashboard" "$DASHBOARD_CODE" 200
echo ""

# Test 17: Unauthorized request
echo "Test 17: Unauthorized request (no token)"
UNAUTH_CODE=$(http_code "${API_URL}/api/tasks" \
  -H "Content-Type: application/json")
print_result "Unauthorized request" "$UNAUTH_CODE" 401
echo ""

# Test 18: Invalid status transition
echo "Test 18: Invalid status transition (done → in_progress)"
TRANSITION_CODE=$(http_code -X PATCH "${API_URL}/api/tasks/${TASK_ID}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}')
# Task doesn't exist (was deleted), so we expect 404
print_result "Invalid transition (task not found)" "$TRANSITION_CODE" 404
echo ""

# Test 19: Missing required fields
echo "Test 19: Missing required field (no title)"
MISSING_CODE=$(http_code -X POST "${API_URL}/api/tasks" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
print_result "Missing required field" "$MISSING_CODE" 400
echo ""

# Test 20: Invalid project ID
echo "Test 20: Invalid project ID"
INVALID_PROJECT_CODE=$(http_code -X POST "${API_URL}/api/tasks" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"test","project_id":"proj_invalid"}')
print_result "Invalid project ID" "$INVALID_PROJECT_CODE" 400
echo ""

# Test 21: Create project
echo "Test 21: Create project (POST /api/projects)"
NEW_PROJECT_CODE=$(http_code -X POST "${API_URL}/api/projects" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Project","code":"TEST","description":"Integration test project"}')
print_result "Create project" "$NEW_PROJECT_CODE" 201
echo ""

echo "======================================"
echo -e "${GREEN}All tests passed!${NC}"
echo "======================================"
