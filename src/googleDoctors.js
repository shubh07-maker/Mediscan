function toRad(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const GOOGLE_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";

export async function fetchNearbyDoctorsFromGoogle({ apiKey, location, specialty = "", limit = 12 }) {
  if (!apiKey) {
    return { center: null, doctors: [] };
  }

  const locationQuery = String(location || "").trim();
  if (!locationQuery) {
    throw new Error("Location is required.");
  }

  const geoUrl = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(locationQuery)}&key=${encodeURIComponent(apiKey)}`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) {
    throw new Error(`Google geocode failed (${geoRes.status}).`);
  }
  const geoData = await geoRes.json();
  if (geoData.status !== "OK" || !Array.isArray(geoData.results) || geoData.results.length === 0) {
    return { center: null, doctors: [] };
  }

  const center = geoData.results[0];
  const centerLat = center.geometry?.location?.lat;
  const centerLon = center.geometry?.location?.lng;
  if (centerLat == null || centerLon == null) {
    return { center: null, doctors: [] };
  }

  const queryParts = ["doctor"];
  if (specialty) queryParts.push(specialty);
  queryParts.push("near");
  queryParts.push(locationQuery);
  const searchQuery = queryParts.join(" ");

  const textSearchUrl =
    `${GOOGLE_TEXT_SEARCH_URL}?query=${encodeURIComponent(searchQuery)}&key=${encodeURIComponent(apiKey)}`;
  const searchRes = await fetch(textSearchUrl);
  if (!searchRes.ok) {
    throw new Error(`Google text search failed (${searchRes.status}).`);
  }
  const searchData = await searchRes.json();
  if (!["OK", "ZERO_RESULTS"].includes(searchData.status)) {
    throw new Error(`Google text search error: ${searchData.status}`);
  }

  const doctors = (searchData.results || [])
    .map((item) => {
      const lat = item.geometry?.location?.lat;
      const lon = item.geometry?.location?.lng;
      if (lat == null || lon == null) return null;
      return {
        id: `google-${item.place_id}`,
        name: item.name || "Doctor",
        specialty: specialty || "Doctor",
        address: item.formatted_address || item.vicinity || "Address not available",
        distanceKm: Number(haversineKm(centerLat, centerLon, lat, lon).toFixed(2)),
        rating: item.rating ?? null,
        reviewsCount: item.user_ratings_total ?? null,
        source: "Google Places"
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);

  return {
    center: {
      location: center.formatted_address || locationQuery,
      lat: centerLat,
      lon: centerLon
    },
    doctors
  };
}
