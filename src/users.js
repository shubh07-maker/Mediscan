const userStore = new Map();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidAge(age) {
  const parsed = Number(age);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 120;
}

function isProfileCompleted(user) {
  return Boolean(user?.name && isValidAge(user?.age) && user?.bloodGroup);
}

function toUserView(user) {
  return {
    email: user.email,
    name: user.name || "",
    age: user.age ?? null,
    bloodGroup: user.bloodGroup || "",
    gender: user.gender || "",
    phone: user.phone || "",
    photoDataUrl: user.photoDataUrl || ""
  };
}

export function ensureUser(email, defaultName = "") {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  let existing = userStore.get(normalizedEmail);
  if (!existing) {
    existing = {
      email: normalizedEmail,
      name: defaultName || normalizedEmail.split("@")[0] || "Patient",
      age: null,
      bloodGroup: "",
      gender: "",
      phone: "",
      photoDataUrl: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    userStore.set(normalizedEmail, existing);
  }
  return existing;
}

export function buildAuthPayload({ token, email, defaultName = "" }) {
  const user = ensureUser(email, defaultName);
  return {
    token,
    user: toUserView(user),
    profileCompleted: isProfileCompleted(user)
  };
}

export function updateUserProfile({
  email,
  name,
  age,
  bloodGroup,
  gender,
  phone,
  photoDataUrl
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Valid email is required.");
  }

  if (!name || String(name).trim().length < 2) {
    throw new Error("Name must be at least 2 characters.");
  }

  if (!isValidAge(age)) {
    throw new Error("Age must be an integer between 1 and 120.");
  }

  if (!bloodGroup || String(bloodGroup).trim().length < 2) {
    throw new Error("Blood group is required.");
  }

  const user = ensureUser(normalizedEmail, String(name).trim());
  user.name = String(name).trim();
  user.age = Number(age);
  user.bloodGroup = String(bloodGroup).trim().toUpperCase();
  user.gender = String(gender || "").trim();
  user.phone = String(phone || "").trim();
  user.photoDataUrl = String(photoDataUrl || "").trim();
  user.updatedAt = Date.now();
  userStore.set(normalizedEmail, user);

  return {
    user: toUserView(user),
    profileCompleted: isProfileCompleted(user)
  };
}
