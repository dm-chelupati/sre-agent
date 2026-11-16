import type {
  RiskAssessmentRequest,
  RiskLevel,
  RiskOutcome,
} from "@caldova/contracts";

interface RiskDecision {
  outcome: RiskOutcome;
  riskLevel: RiskLevel;
  reasons: string[];
}

const maximumDailyDoseMg = new Map<string, number>([
  ["acetaminophen", 4_000],
  ["amoxicillin", 3_000],
  ["ibuprofen", 3_200],
  ["metformin", 2_550],
  ["paracetamol", 4_000],
]);

const interactionPairs: ReadonlyArray<readonly [string, string]> = [
  ["clarithromycin", "simvastatin"],
  ["ibuprofen", "warfarin"],
  ["lisinopril", "potassium"],
  ["sildenafil", "nitroglycerin"],
  ["spironolactone", "potassium"],
];

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function medicationMatches(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function ageOnDate(dateOfBirth: string, today: Date): number {
  const [year = 0, month = 1, day = 1] = dateOfBirth
    .split("-")
    .map(Number);
  let age = today.getUTCFullYear() - year;
  const birthdayHasOccurred =
    today.getUTCMonth() + 1 > month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() >= day);
  if (!birthdayHasOccurred) {
    age -= 1;
  }
  return age;
}

export function evaluateMedicationRisk(
  request: RiskAssessmentRequest,
  now: Date = new Date(),
): RiskDecision {
  const medication = normalize(request.prescription.medicationName);
  const currentMedications = request.patient.currentMedications.map(normalize);
  const blockingReasons: string[] = [];
  const advisoryReasons: string[] = [];

  if (
    request.patient.allergies.some((allergy) =>
      medicationMatches(allergy, medication),
    )
  ) {
    blockingReasons.push(
      "The prescribed medication matches a recorded patient allergy.",
    );
  }

  if (
    currentMedications.some((current) =>
      medicationMatches(current, medication),
    )
  ) {
    blockingReasons.push(
      "The prescribed medication duplicates a current medication.",
    );
  }

  for (const [first, second] of interactionPairs) {
    const prescribedIsFirst = medicationMatches(medication, first);
    const prescribedIsSecond = medicationMatches(medication, second);
    const hasCounterpart =
      (prescribedIsFirst &&
        currentMedications.some((current) =>
          medicationMatches(current, second),
        )) ||
      (prescribedIsSecond &&
        currentMedications.some((current) =>
          medicationMatches(current, first),
        ));

    if (hasCounterpart) {
      blockingReasons.push(
        `A medication interaction was detected between ${first} and ${second}.`,
      );
    }
  }

  const configuredMaximum = maximumDailyDoseMg.get(medication);
  const requestedDailyDose =
    request.prescription.doseMg * request.prescription.frequencyPerDay;
  if (
    configuredMaximum !== undefined &&
    requestedDailyDose > configuredMaximum
  ) {
    blockingReasons.push(
      `The requested daily dose exceeds the configured maximum for ${medication}.`,
    );
  }

  const age = ageOnDate(request.patient.dateOfBirth, now);
  if (age >= 65 && medicationMatches(medication, "ibuprofen")) {
    advisoryReasons.push(
      "The prescription requires age-related medication monitoring.",
    );
  }

  if (blockingReasons.length > 0) {
    return {
      outcome: "rejected",
      riskLevel: "high",
      reasons: blockingReasons,
    };
  }

  if (advisoryReasons.length > 0) {
    return {
      outcome: "approved",
      riskLevel: "moderate",
      reasons: advisoryReasons,
    };
  }

  return { outcome: "approved", riskLevel: "low", reasons: [] };
}
