Run the EchoHub code standards linter on the current project or a specific file/directory.

Usage:
- `/lint` — lint the entire project (backend/ + frontend/src/)
- `/lint backend/services/llama_service.py` — lint a specific file
- `/lint backend/services/` — lint a directory

The linter enforces EchoHub's coding standards:
- **Files**: 500 lines max
- **Functions**: 35 lines max
- **Lines**: 120 characters max
- **TypeScript**: no `any`, explicit return types on public functions
- **Python**: type hints on all functions, no bare except
- **Try/catch**: required on any function touching API, DB, filesystem, external service
- **Naming**: camelCase (TS vars/funcs), PascalCase (TS types/components), snake_case (Python), SCREAMING_SNAKE (constants)
- **Architecture**: one responsibility per file, no logic at module level

Run the linter script:

```bash
cd /mnt/projects/echohub && backend/.venv/bin/python scripts/lint_standards.py $ARGUMENTS
```

Report ALL violations found. For each violation, show:
- File path and line number
- Rule violated
- The offending code snippet (1-3 lines)
- Suggested fix

After reporting, give a summary: X files checked, Y violations (Z errors, W warnings).
Errors (must fix): file too long, function too long, missing try/catch on external calls.
Warnings (should fix): line too long, missing type hints, naming issues.

If violations are found, ask the user which ones to fix automatically.
