/**
 * Open-Meteo connector (free, no API key). The server proxies and caches so
 * every open rackio tab doesn't hammer the API — weather changes slowly.
 */

export type SceneMode = "clear" | "cloudy" | "rain" | "storm" | "snow";

export interface WeatherReport {
  sceneMode: SceneMode;
  condition: string;
  temperature: number;
  feelsLike: number;
  high: number;
  low: number;
  windKmh: number;
  humidity: number;
  precipChance: number;
  visibilityKm: number;
  isDay: boolean;
  updatedAt: number;
}

/** WMO weather interpretation codes → scene + human condition. */
export function interpretWmoCode(code: number): {
  sceneMode: SceneMode;
  condition: string;
} {
  if (code === 0) return { sceneMode: "clear", condition: "Clear skies" };
  if (code === 1) return { sceneMode: "clear", condition: "Mostly clear" };
  if (code === 2) return { sceneMode: "cloudy", condition: "Partly cloudy" };
  if (code === 3) return { sceneMode: "cloudy", condition: "Overcast" };
  if (code === 45 || code === 48) return { sceneMode: "cloudy", condition: "Fog" };
  if (code >= 51 && code <= 57) return { sceneMode: "rain", condition: "Drizzle" };
  if (code >= 61 && code <= 67) return { sceneMode: "rain", condition: "Rain" };
  if (code >= 71 && code <= 77) return { sceneMode: "snow", condition: "Snow" };
  if (code >= 80 && code <= 82) return { sceneMode: "rain", condition: "Rain showers" };
  if (code === 85 || code === 86) return { sceneMode: "snow", condition: "Snow showers" };
  if (code >= 95) return { sceneMode: "storm", condition: "Thunderstorms nearby" };
  return { sceneMode: "cloudy", condition: "Changeable" };
}

interface CacheEntry {
  report: WeatherReport;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export async function getWeather(
  lat: number,
  lon: number,
): Promise<WeatherReport> {
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.report;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
  );
  url.searchParams.set("hourly", "precipitation_probability,visibility");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`open-meteo responded ${response.status}`);
  }
  const data = (await response.json()) as {
    current: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      weather_code: number;
      wind_speed_10m: number;
      is_day: number;
    };
    hourly: {
      time: string[];
      precipitation_probability: (number | null)[];
      visibility: (number | null)[];
    };
    daily: {
      temperature_2m_max: number[];
      temperature_2m_min: number[];
    };
  };

  // Pick the hourly entry matching the current observation hour.
  const hourIso = data.current.time.slice(0, 13);
  const hourIndex = Math.max(
    0,
    data.hourly.time.findIndex((t) => t.startsWith(hourIso)),
  );

  const { sceneMode, condition } = interpretWmoCode(data.current.weather_code);
  const report: WeatherReport = {
    sceneMode,
    condition,
    temperature: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    windKmh: Math.round(data.current.wind_speed_10m),
    humidity: Math.round(data.current.relative_humidity_2m),
    precipChance: Math.round(
      data.hourly.precipitation_probability[hourIndex] ?? 0,
    ),
    visibilityKm:
      Math.round(((data.hourly.visibility[hourIndex] ?? 0) / 1000) * 10) / 10,
    isDay: data.current.is_day === 1,
    updatedAt: Date.now(),
  };

  cache.set(key, { report, expiresAt: Date.now() + CACHE_TTL_MS });
  return report;
}

export interface GeocodeMatch {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
}

export async function geocode(query: string): Promise<GeocodeMatch[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`open-meteo geocoding responded ${response.status}`);
  }
  const data = (await response.json()) as {
    results?: Array<{
      name: string;
      admin1?: string;
      country?: string;
      latitude: number;
      longitude: number;
    }>;
  };
  return (data.results ?? []).map((r) => ({
    name: r.name,
    region: r.admin1 ?? "",
    country: r.country ?? "",
    lat: r.latitude,
    lon: r.longitude,
  }));
}
