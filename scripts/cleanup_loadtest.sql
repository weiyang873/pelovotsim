BEGIN;

CREATE TEMP TABLE _loadtest_teams AS
SELECT id
FROM teams
WHERE team_name LIKE 'loadtest_%';

CREATE TEMP TABLE _loadtest_members AS
SELECT id
FROM team_members
WHERE team_id IN (SELECT id FROM _loadtest_teams);

-- Delete leaf tables first, then member/team rows.
DELETE FROM round2_interview_sessions
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM round2_member_selections
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM round2_dimension_assignments
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM round2_submissions
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM fg_team_radar
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM round2_results
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM round2_team_drafts
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM marketing_sessions
WHERE team_key IN (SELECT id FROM _loadtest_teams);

DELETE FROM vp_sessions
WHERE team_key IN (SELECT id FROM _loadtest_teams);

DELETE FROM vp_iterations
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM computation_log
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM teacher_actions
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM llm_call_metrics
WHERE team_key IN (SELECT id FROM _loadtest_teams);

DELETE FROM llm_wizard_outputs
WHERE team_key IN (SELECT id FROM _loadtest_teams);

DELETE FROM team_runs
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM iteration_events
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM round1_team_drafts
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM member_submissions
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM jinang_settlements
WHERE team_id IN (SELECT id FROM _loadtest_teams)
   OR member_id IN (SELECT id FROM _loadtest_members);

DELETE FROM students
WHERE team_id IN (SELECT id FROM _loadtest_teams)
   OR member_id IN (SELECT id FROM _loadtest_members);

DELETE FROM team_members
WHERE team_id IN (SELECT id FROM _loadtest_teams);

DELETE FROM teams
WHERE id IN (SELECT id FROM _loadtest_teams);

COMMIT;
