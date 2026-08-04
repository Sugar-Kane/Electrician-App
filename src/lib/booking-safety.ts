export type SafetyAnswerMap = Record<string, boolean>;

export type SafetyOutcome =
  | "standard"
  | "urgent_review"
  | "emergency_services"
  | "utility_referral";

export type SafetyQuestion = {
  id: string;
  label: string;
  help?: string;
};

const hazardPatterns = {
  fire: /\b(fire|flame|smok(?:e|ing)|burning|burnt|melt(?:ed|ing))\b/i,
  spark: /\b(spark(?:s|ing)?|arc(?:ing|ed)?)\b/i,
  shock: /\b(shock(?:ed)?|electrocut(?:e|ed|ion))\b/i,
  water: /\b(water|flood(?:ed|ing)?|leak(?:ing)?)\b/i,
  line: /\b(downed|fallen)\b.*\b(line|wire|power)\b|\bpower line\b/i,
  heat: /\b(hot|heat|overheat(?:ed|ing)?)\b/i,
  outage: /\b(no power|power out|outage|whole (?:house|home|building))\b/i,
  medical: /\b(medical|oxygen|ventilator|dialysis|life support)\b/i,
};

const detailedHazardQuestions: SafetyQuestion[] = [
  {
    id: "active_fire_or_smoke",
    label: "Is there active fire or visible smoke right now?",
  },
  {
    id: "active_sparking",
    label: "Is anything actively sparking or arcing right now?",
  },
  {
    id: "shock_injury",
    label: "Did anyone receive an electrical shock or injury?",
  },
  {
    id: "water_touching_electrical",
    label: "Is water touching energized equipment, outlets, or the panel?",
  },
  {
    id: "downed_power_line",
    label: "Is there a downed or fallen utility power line?",
  },
];

export function getAdaptiveSafetyQuestions(
  description: string,
  answers: SafetyAnswerMap,
): SafetyQuestion[] {
  const questions: SafetyQuestion[] = [];
  const matchedHazard = Object.values(hazardPatterns).some((pattern) =>
    pattern.test(description),
  );

  if (!matchedHazard) {
    questions.push({
      id: "any_immediate_hazard",
      label: "Are there any immediate hazards right now?",
      help: "Examples include fire, smoke, active sparking, an electrical injury, water touching electrical equipment, or a downed power line.",
    });
  }

  if (matchedHazard || answers.any_immediate_hazard) {
    const relevantQuestionIds = new Set<string>();
    if (hazardPatterns.fire.test(description) || hazardPatterns.heat.test(description)) {
      relevantQuestionIds.add("active_fire_or_smoke");
    }
    if (hazardPatterns.spark.test(description)) relevantQuestionIds.add("active_sparking");
    if (hazardPatterns.shock.test(description)) relevantQuestionIds.add("shock_injury");
    if (hazardPatterns.water.test(description)) relevantQuestionIds.add("water_touching_electrical");
    if (hazardPatterns.line.test(description)) relevantQuestionIds.add("downed_power_line");

    if (answers.any_immediate_hazard) {
      detailedHazardQuestions.forEach((question) => relevantQuestionIds.add(question.id));
    }

    detailedHazardQuestions.forEach((question) => {
      if (relevantQuestionIds.has(question.id)) questions.push(question);
    });
  }

  if (hazardPatterns.fire.test(description) || hazardPatterns.heat.test(description)) {
    questions.push({
      id: "burning_smell_or_hot_equipment",
      label: "Is there a burning smell or electrical equipment that feels unusually hot?",
    });
  }

  if (hazardPatterns.outage.test(description)) {
    questions.push(
      {
        id: "whole_building_outage",
        label: "Is the entire building without power?",
      },
      {
        id: "neighbors_without_power",
        label: "Are nearby homes or businesses also without power?",
      },
    );
  }

  questions.push({
    id: "powered_medical_equipment",
    label: "Does anyone at the property depend on powered medical equipment?",
  });

  return questions.filter(
    (question, index, all) =>
      all.findIndex((candidate) => candidate.id === question.id) === index,
  );
}

export function evaluateSafety(
  description: string,
  answers: SafetyAnswerMap,
): { outcome: SafetyOutcome; flags: string[] } {
  const flags = new Set<string>();

  if (answers.any_immediate_hazard) flags.add("reported_immediate_hazard");
  if (answers.active_fire_or_smoke) flags.add("active_fire_or_smoke");
  if (answers.active_sparking) flags.add("active_sparking");
  if (answers.shock_injury) flags.add("shock_injury");
  if (answers.water_touching_electrical) flags.add("water_touching_electrical");
  if (answers.downed_power_line) flags.add("downed_power_line");
  if (answers.burning_smell_or_hot_equipment) flags.add("burning_smell_or_hot_equipment");
  if (answers.powered_medical_equipment) flags.add("powered_medical_equipment");
  if (answers.whole_building_outage) flags.add("whole_building_outage");
  if (answers.neighbors_without_power) flags.add("neighbors_without_power");

  if (
    answers.active_fire_or_smoke ||
    answers.shock_injury ||
    answers.water_touching_electrical ||
    answers.downed_power_line
  ) {
    return { outcome: "emergency_services", flags: [...flags] };
  }

  if (answers.whole_building_outage && answers.neighbors_without_power) {
    return { outcome: "utility_referral", flags: [...flags] };
  }

  if (
    answers.any_immediate_hazard ||
    answers.active_sparking ||
    answers.burning_smell_or_hot_equipment ||
    answers.powered_medical_equipment ||
    hazardPatterns.fire.test(description) ||
    hazardPatterns.spark.test(description) ||
    hazardPatterns.shock.test(description)
  ) {
    return { outcome: "urgent_review", flags: [...flags] };
  }

  return { outcome: "standard", flags: [...flags] };
}

export function categoryFromDescription(description: string) {
  if (/\b(ev|electric vehicle|charger)\b/i.test(description)) return "ev_charger";
  if (/\b(panel|breaker|service upgrade)\b/i.test(description)) return "panel_breaker";
  if (/\b(light|lighting|fixture)\b/i.test(description)) return "lighting";
  if (/\b(outlet|receptacle|switch)\b/i.test(description)) return "outlet_switch";
  if (hazardPatterns.outage.test(description)) return "power_loss";
  return "diagnostic";
}
