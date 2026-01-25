run:
    uv run python main.py

lint:
    uv run ruff check . --fix
    uv run ruff format