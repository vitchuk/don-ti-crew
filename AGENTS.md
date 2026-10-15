# AI Dev Assistant

## Project

This project is an AI-powered developer assistant.

The assistant will eventually:

- understand project documentation using RAG;
- access project context through MCP;
- answer questions about the project;
- perform automated AI code reviews;
- support multi-agent software development workflows.

## Development methodology

This project follows Specification Driven Development (SDD).

For non-trivial changes:

1. Clarify the problem and requirements.
2. Validate terminology and important decisions.
3. Create the specification.
4. Analyze the architecture.
5. Create an implementation plan.
6. Implement the change.
7. Run tests.
8. Review the implementation.

## Requirements clarification

When a task is ambiguous, do not guess.

Use `/grill-with-docs` to interview the user and clarify:

- goals;
- terminology;
- scope;
- constraints;
- expected behavior;
- architectural decisions.

Do not start implementation while important requirements remain unresolved.

## Documentation

Important domain terminology must be recorded in the project glossary.

Important architectural decisions must be recorded as ADRs in:

docs/adr/

## Agent responsibilities

### Analyst

Analyze requirements, architecture, risks and implementation plans.

Do not implement production code.

### Developer

Implement an approved specification and implementation plan.

Do not invent requirements.

### Reviewer

Review implementation for correctness, architecture, security, maintainability and specification compliance.

### QA

Verify acceptance criteria, run tests and identify regressions.

## General rules

- Prefer simple solutions.
- Do not introduce dependencies without justification.
- Do not silently change architectural decisions.
- Do not modify unrelated parts of the project.
- Keep documentation synchronized with important decisions.