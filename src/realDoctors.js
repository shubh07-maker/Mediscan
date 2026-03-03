const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

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

function buildAddress(tags = {}) {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:city"] || tags["addr:town"] || tags["addr:village"],
    tags["addr:state"]
  ]
    .filter(Boolean)
    .join(", ");
  return parts || tags.name || "Address not available";
}

function specialtyToKeywords(specialty = "") {
  const text = String(specialty || "").toLowerCase().trim();
  if (!text) return [];

  const groups = [
    { test: ["endocr", "diabet", "thyroid", "hormone"], keywords: ["endocrin", "diabet", "thyroid", "hormone"] },
    { test: ["nephro", "kidney", "renal"], keywords: ["nephro", "kidney", "renal", "dialysis"] },
    { test: ["gastro", "liver", "hepat", "stomach"], keywords: ["gastro", "digestive", "hepat", "liver", "stomach", "intestinal"] },
    { test: ["hemat", "blood", "anemia"], keywords: ["hemat", "blood", "anemia"] },
    { test: ["cardio", "heart"], keywords: ["cardio", "heart"] },
    { test: ["neuro", "brain"], keywords: ["neuro", "brain"] },
    { test: ["ortho", "bone", "joint"], keywords: ["ortho", "bone", "joint"] },
    { test: ["derma", "skin"], keywords: ["derma", "skin"] },
    { test: ["pedia", "child", "paedia"], keywords: ["pedia", "child", "paedia"] },
    { test: ["gyne", "gynae", "obstet", "women", "obgyn"], keywords: ["gyne", "gynae", "gyneco", "obstet", "obgyn", "women"] },
    { test: ["pulmo", "chest", "lung"], keywords: ["pulmo", "chest", "lung"] },
    { test: ["ent", "ear", "nose", "throat"], keywords: ["ent", "ear", "nose", "throat"] },
    { test: ["internal", "general", "physician"], keywords: ["internal", "general medicine", "physician", "general"] }
  ];

  for (const group of groups) {
    if (group.test.some((t) => text.includes(t))) {
      return group.keywords;
    }
  }

  return text
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function matchesSpecialty(tags = {}, specialty = "") {
  const keywords = specialtyToKeywords(specialty);
  if (keywords.length === 0) return true;

  const haystack = [
    tags.name,
    tags.speciality,
    tags["healthcare:speciality"],
    tags.healthcare,
    tags.amenity,
    tags.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
  return keywords.some((k) => {
    if (k.length <= 3) {
      return words.includes(k);
    }
    return words.some((w) => w === k || w.startsWith(k) || k.startsWith(w));
  });
}

export async function fetchNearbyDoctors({ location, specialty = "", radiusMeters = 12000, limit = 12 }) {
  const query = String(location || "").trim();
  if (!query) {
    throw new Error("Location is required.");
  }

  const geoUrl = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&addressdetails=1`;
  const geoRes = await fetch(geoUrl, {
    headers: {
      "User-Agent": "MediScan-AI/1.0 (educational project)"
    }
  });

  if (!geoRes.ok) {
    throw new Error(`Geocoding failed (${geoRes.status}).`);
  }

  const geoData = await geoRes.json();
  if (!Array.isArray(geoData) || geoData.length === 0) {
    return { center: null, doctors: [] };
  }

  const centerLat = Number.parseFloat(geoData[0].lat);
  const centerLon = Number.parseFloat(geoData[0].lon);
  const displayName = geoData[0].display_name || query;

  const overpassQuery = `
[out:json][timeout:25];
(
  node["amenity"~"doctors|clinic|hospital"](around:${radiusMeters},${centerLat},${centerLon});
  way["amenity"~"doctors|clinic|hospital"](around:${radiusMeters},${centerLat},${centerLon});
  relation["amenity"~"doctors|clinic|hospital"](around:${radiusMeters},${centerLat},${centerLon});
);
out center tags;
`;

  const overpassRes = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "MediScan-AI/1.0 (educational project)"
    },
    body: `data=${encodeURIComponent(overpassQuery)}`
  });

  if (!overpassRes.ok) {
    throw new Error(`Nearby search failed (${overpassRes.status}).`);
  }

  const overpassData = await overpassRes.json();
  const elements = Array.isArray(overpassData?.elements) ? overpassData.elements : [];

  const allNearby = elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) return null;
      return {
        id: `osm-${el.type}-${el.id}`,
        name: el.tags?.name || "Medical Center",
        specialty: el.tags?.["healthcare:speciality"] || el.tags?.speciality || el.tags?.healthcare || "General",
        address: buildAddress(el.tags),
        lat,
        lon,
        distanceKm: Number(haversineKm(centerLat, centerLon, lat, lon).toFixed(2)),
        source: "OpenStreetMap"
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const specialtyFiltered = allNearby.filter((d) =>
    matchesSpecialty({ name: d.name, speciality: d.specialty }, specialty)
  );

  const usingFallback = Boolean(specialty) && specialtyFiltered.length === 0;
  const doctors = (usingFallback ? allNearby : specialtyFiltered).slice(0, limit);

  return {
    center: {
      location: displayName,
      lat: centerLat,
      lon: centerLon
    },
    doctors,
    filterMeta: {
      specialtyQuery: specialty || "",
      fallbackUsed: usingFallback,
      specialtyMatches: specialtyFiltered.length,
      totalNearby: allNearby.length
    }
  };
}
