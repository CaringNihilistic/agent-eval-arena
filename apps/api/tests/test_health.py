import httpx
import pytest
from fastapi.testclient import TestClient

from arena import __version__
from arena.main import create_app
from arena.routes import health
from arena.settings import Settings, get_settings


def client_with(settings: Settings) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def test_health_without_sandbox_configured() -> None:
    response = client_with(Settings(sandbox_url=None)).get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__, "sandbox": "not_configured"}


def test_health_reports_unreachable_sandbox() -> None:
    settings = Settings(sandbox_url="http://127.0.0.1:1", sandbox_health_timeout_s=0.2)

    response = client_with(settings).get("/api/health")

    assert response.status_code == 200
    assert response.json()["sandbox"] == "unreachable"


@pytest.mark.parametrize(("status_code", "expected"), [(200, "ok"), (500, "unreachable")])
async def test_sandbox_status_follows_its_health_endpoint(
    monkeypatch: pytest.MonkeyPatch, status_code: int, expected: str
) -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(status_code))
    real_client = httpx.AsyncClient

    def fake_client(timeout: float) -> httpx.AsyncClient:
        return real_client(transport=transport, timeout=timeout)

    monkeypatch.setattr("arena.routes.health.httpx.AsyncClient", fake_client)

    assert await health.check_sandbox(Settings(sandbox_url="http://sandbox:8001")) == expected


def test_cors_allows_the_web_origin() -> None:
    settings = Settings()
    origin = settings.cors_origins[0]

    response = client_with(settings).get("/api/health", headers={"Origin": origin})

    assert response.headers["access-control-allow-origin"] == origin
