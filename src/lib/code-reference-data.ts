/**
 * The California and federal reference index, as data.
 *
 * Not prose in a prompt. A model asked "what governs a service upgrade in
 * Nipomo" from memory will produce a confident answer with a plausible article
 * number in it, and a wrong CEC citation is worse than no citation — somebody
 * pulls a permit against it.
 *
 * So the assistant retrieves from this list and quotes what it finds. Every
 * entry carries its own official source, and an answer that cannot point at an
 * entry has to say so.
 *
 * Import-free, so retrieval can be tested without a model.
 */

export type ReferenceEntry = {
  /** Stable id from the source index, e.g. "LIC-C10". */
  id: string;
  section: string;
  title: string;
  /** What it says, compressed but not paraphrased into vagueness. */
  detail: string;
  /** Where to read the controlling text. */
  source?: string;
  /** Extra search terms that should find this entry. */
  keywords?: string[];
};

/**
 * The caveat that travels with every answer.
 *
 * The source document says it plainly and so must anything built on it: this
 * is a research map, and the authority having jurisdiction decides.
 */
export const REFERENCE_CAVEAT =
  "This is a research map, not legal advice, and not a substitute for the adopted code, the AHJ, CSLB, DIR, Cal/OSHA, the fire authority, or the serving utility. Verify against the controlling text before relying on it.";

export const CODE_EDITION =
  "2025 California Building Standards Code, effective 1 January 2026 through 31 December 2028. Part 3 (California Electrical Code) is based on the 2023 NEC with California amendments. Check errata and supplements.";

export const REFERENCE_ENTRIES: ReferenceEntry[] = [
  // ---- Verification sequence -------------------------------------------------
  {
    id: "VERIFY-FACTS",
    section: "Verification sequence",
    title: "Facts to collect before deciding what applies",
    detail:
      "Exact address, city, county, fire district and serving utility. Building type. New or existing, original construction year and later alteration dates. Scope of work. Total project value including labour and materials. Who contracts, permits, supervises and connects. Whether employees, trainees, apprentices, subcontractors or home-improvement salespersons are used. Whether paint, coatings, flooring, insulation or fireproofing will be disturbed, especially pre-1978. Whether public money, federal assistance or a utility incentive is involved. Whether the building stays occupied and whether energised work is proposed.",
    keywords: ["intake", "what do I need to know", "before quoting", "scoping"],
  },
  {
    id: "VERIFY-ORDER",
    section: "Verification sequence",
    title: "Order to verify in",
    detail:
      "1. Current state code edition, errata and supplements. 2. City or county amendments, permit rules, submittals and inspection list. 3. Fire authority requirements. 4. Utility service and interconnection rules. 5. CSLB licence status and classification. 6. DIR certification or trainee/apprentice status of each field worker. 7. Contract, safety, environmental, accessibility, energy and public-works overlays.",
    keywords: ["order", "sequence", "checklist"],
  },

  // ---- Code set --------------------------------------------------------------
  {
    id: "CA-T24-P3",
    section: "Code set",
    title: "California Electrical Code (Title 24 Part 3)",
    detail:
      "The primary installation code for electrical work in all occupancies. The 2025 CEC is based on the 2023 NEC with California amendments. An unamended NEC is not a substitute for it.",
    source: "https://www.dgs.ca.gov/BSC/Codes",
    keywords: ["CEC", "NEC", "electrical code", "which code"],
  },
  {
    id: "CA-T24-P6",
    section: "Code set",
    title: "California Energy Code (Title 24 Part 6)",
    detail:
      "Residential lighting; nonresidential lighting power and controls; electrical power distribution; PV and ESS; commissioning and acceptance testing. Lighting alterations commonly trigger compliance, installation and acceptance forms.",
    source:
      "https://www.energy.ca.gov/programs-and-topics/programs/building-energy-efficiency-standards/2025-building-energy-efficiency",
    keywords: ["Title 24 energy", "lighting controls", "acceptance test", "JA8"],
  },
  {
    id: "CA-T24-P11",
    section: "Code set",
    title: "CALGreen (Title 24 Part 11)",
    detail:
      "Mandatory green measures, including EV-capable, EV-ready and EVSE infrastructure requirements, and construction waste measures.",
    source: "https://www.dgs.ca.gov/BSC/Codes",
    keywords: ["CALGreen", "EV ready", "EV capable", "EVSE"],
  },
  {
    id: "CA-T24-P9",
    section: "Code set",
    title: "California Fire Code (Title 24 Part 9)",
    detail:
      "Fire alarms, emergency systems, PV and ESS provisions, hazardous materials, fire-department access and operational permits.",
    source: "https://www.dgs.ca.gov/BSC/Codes",
    keywords: ["fire code", "CFC", "fire alarm", "ESS"],
  },
  {
    id: "CA-T24-P10",
    section: "Code set",
    title: "California Existing Building Code (Title 24 Part 10)",
    detail:
      "Alterations, repairs, additions and changes of occupancy. Determines which existing-building upgrades are triggered and how far they reach.",
    source: "https://www.dgs.ca.gov/BSC/Codes",
    keywords: ["existing building", "remodel triggers", "grandfathered"],
  },
  {
    id: "CA-LOCAL",
    section: "Code set",
    title: "Local amendments",
    detail:
      "City and county building, electrical and fire ordinances may be more restrictive than the state code and control permits, plans, fees, inspections and local details. Always checked per address.",
    source: "https://www.dgs.ca.gov/BSC/Codes/2025-Ordinances",
    keywords: ["local amendment", "city code", "county code"],
  },
  {
    id: "CA-UTILITY",
    section: "Code set",
    title: "Serving utility requirements",
    detail:
      "Meter and service equipment, available fault current, clearances, trenching, transformer, Rule 21 interconnection, and permission to operate for solar or storage. Separate from the city final inspection.",
    keywords: ["utility", "PG&E", "Rule 21", "permission to operate", "PTO", "meter"],
  },

  // ---- Licensing -------------------------------------------------------------
  {
    id: "LIC-C10",
    section: "Licensing",
    title: "C-10 Electrical Contractor",
    detail:
      "A C-10 may install or connect electrical wires, fixtures, apparatus, raceways, conduit and PV equipment. The classification covers both residential and commercial work.",
    source:
      "https://www.cslb.ca.gov/about_us/library/licensing_classifications/Licensing_Classifications_Detail.aspx?Class=C-10",
    keywords: ["C-10", "electrical contractor licence", "what can a C-10 do"],
  },
  {
    id: "LIC-THRESHOLD",
    section: "Licensing",
    title: "When a contractor licence is required",
    detail:
      "Generally required when the aggregate price of labour, materials and other items is $1,000 or more, when a permit is required, when workers are employed, when the work is part of a larger project, or when the person advertises or holds out as a contractor. BPC §7048.",
    source:
      "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=7048.",
    keywords: ["licence threshold", "$500", "$1000", "handyman", "do I need a licence"],
  },
  {
    id: "LIC-BOND",
    section: "Licensing",
    title: "Contractor bond",
    detail:
      "An active licence normally requires a $25,000 contractor bond. A qualifier bond may also be required. BPC §§7071.6, 7071.9.",
    source: "https://web.cslb.ca.gov/Contractors/Maintain_License/Bond_Information/Bond_Requirements.aspx",
    keywords: ["bond", "25000", "surety"],
  },
  {
    id: "LIC-PERMIT-DECL",
    section: "Licensing",
    title: "Licence declaration on a permit application",
    detail:
      "A city or county requiring a permit also requires the contractor's signed licence statement and licence number, or an unlicensed applicant's signed basis for exemption. BPC §7031.5.",
    keywords: ["permit declaration", "licence number on permit"],
  },
  {
    id: "WORK-CERT",
    section: "Licensing",
    title: "Individual electrician certification",
    detail:
      "A person performing electrician work for a C-10 contractor generally must hold DIR certification in the correct category, or be a lawfully registered trainee or apprentice. Labor Code §§108–108.5; 8 CCR §§290–296.4. CSLB licensure does not satisfy this, and this does not satisfy CSLB licensure.",
    source: "https://dir.ca.gov/dlse/ECU/ElectricalTrade.html",
    keywords: ["certification", "certified electrician", "DIR card"],
  },
  {
    id: "WORK-QUAL-EX",
    section: "Licensing",
    title: "Qualifying-person exception",
    detail:
      "The qualifying person who took the contractor-licence examination may perform electrical work for that licensed contractor without a separate state electrician certificate. Non-qualifying owners, partners and officers do not get this exception, and a C-10 qualifier working as an employee under another C-10 licence must be certified. Labor Code §108.2(g).",
    source: "https://dir.ca.gov/dlse/ecu/ecu_faq.htm",
    keywords: ["qualifier", "exception", "owner exempt"],
  },
  {
    id: "WORK-CATEGORIES",
    section: "Licensing",
    title: "Certification categories and hours",
    detail:
      "General electrician 8,000 hours; residential 4,800; fire/life/safety technician 4,000; voice/data/video technician 4,000; nonresidential lighting technician 2,000. Each requires the category examination and is limited to that category's lawful scope.",
    source: "https://www.dir.ca.gov/dlse/ecu/EleCat.html",
    keywords: ["hours", "general electrician", "residential electrician", "categories"],
  },
  {
    id: "WORK-TRAINEE",
    section: "Licensing",
    title: "Electrician trainee",
    detail:
      "Must be registered, enrolled in an approved curriculum, and directly supervised by a certified electrician who supervises no more than one trainee. Labor Code §108.4.",
    source: "https://www.dir.ca.gov/dlse/ecu/ElectricalTrainee.htm",
    keywords: ["trainee", "apprentice supervision", "ratio"],
  },
  {
    id: "WORK-RENEW",
    section: "Licensing",
    title: "Certification renewal",
    detail:
      "Three-year renewal with 32 hours of relevant continuing education and 2,000 hours worked in the industry. 8 CCR §291.5.",
    keywords: ["renewal", "continuing education", "CE hours"],
  },

  // ---- Contracts -------------------------------------------------------------
  {
    id: "CONTRACT-500",
    section: "Contracts",
    title: "Written home-improvement contract",
    detail:
      "Required when the aggregate contract price exceeds $500. Must carry the required notices, description of work, dates, payment schedule, permit responsibility, signatures and copies. BPC §7159.",
    source:
      "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=7159",
    keywords: ["home improvement contract", "written contract", "$500"],
  },
  {
    id: "CONTRACT-DOWN",
    section: "Contracts",
    title: "Down payment limit",
    detail:
      "A down payment generally may not exceed the lesser of $1,000 or 10% of the contract price. Progress payments cannot exceed the value of work performed and material delivered, subject to narrow statutory exceptions. BPC §§7159, 7159.5.",
    source: "https://cslb.ca.gov/Consumers/Hire_A_Contractor/Home_Improvement_Contracts/What_Is_A_Contract.aspx",
    keywords: ["deposit", "down payment", "10 percent", "progress payment"],
  },
  {
    id: "CONTRACT-CANCEL",
    section: "Contracts",
    title: "Cancellation rights",
    detail:
      "The ordinary three-day right, a five-day right for qualifying senior transactions, and a seven-day disaster-repair right, each with statutory exceptions. BPC §7159; Civil Code §§1689.5–1689.14.",
    keywords: ["cancel", "right to cancel", "three day", "senior"],
  },
  {
    id: "CONTRACT-SR",
    section: "Contracts",
    title: "Service and repair contracts",
    detail:
      "The special service-and-repair form is limited to $750 or less and requires every statutory condition: buyer-initiated contact, only reasonably necessary work, a written contract, and no payment before completion. If any condition is unmet, full home-improvement rules may apply. BPC §§7159.10–7159.14.",
    keywords: ["service and repair", "$750", "small job contract"],
  },
  {
    id: "CONTRACT-CHANGE",
    section: "Contracts",
    title: "Change orders",
    detail:
      "Scope or price changes must be documented and signed before the changed work is performed. BPC §7159.",
    keywords: ["change order", "extra work", "variation"],
  },

  // ---- Housing and life safety ----------------------------------------------
  {
    id: "HOUSE-SMOKE",
    section: "Housing and life safety",
    title: "Smoke alarms on permitted work",
    detail:
      "Permits for qualifying dwelling alterations, repairs or additions over $1,000 cannot be finalised until the required listed smoke alarms are demonstrated. Health and Safety Code §13113.7.",
    source:
      "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=HSC&sectionNum=13113.7",
    keywords: ["smoke alarm", "final inspection", "$1000"],
  },
  {
    id: "HOUSE-CO",
    section: "Housing and life safety",
    title: "Carbon monoxide devices",
    detail:
      "Listed carbon-monoxide devices are required in dwellings with fossil-fuel equipment, fireplaces or an attached garage. Health and Safety Code §§17926–17926.2.",
    keywords: ["carbon monoxide", "CO alarm"],
  },
  {
    id: "HOUSE-SUB",
    section: "Housing and life safety",
    title: "Substandard wiring",
    detail:
      "Unsafe wiring is a substandard-building condition. Wiring that was lawful when installed may remain if it is currently safe and working properly — which is not the same as 'grandfathered means it can stay'. HSC §17920.3.",
    keywords: ["grandfathered", "knob and tube", "substandard", "old wiring"],
  },
  {
    id: "HOUSE-HAB",
    section: "Housing and life safety",
    title: "Rental habitability",
    detail:
      "Electrical lighting, wiring and equipment must have conformed when installed and be maintained in good working order. Civil Code §1941.1.",
    keywords: ["rental", "landlord", "habitability", "tenant"],
  },

  // ---- Permits ---------------------------------------------------------------
  {
    id: "PERMIT-RULE",
    section: "Permits",
    title: "Permit exemptions are local and narrow",
    detail:
      "Replacement in kind may be exempt in one city and permitted in another. A permit exemption never excuses compliance with the electrical code, licensing law, safety law or required product listing, and it does not create a contractor-licence exemption.",
    keywords: ["permit exemption", "do I need a permit", "replacement in kind"],
  },
  {
    id: "PERMIT-R02",
    section: "Permits",
    title: "Service replacement, upgrade or relocation",
    detail:
      "Electrical permit, load calculation, utility service approval, meter location, grounding electrode, fault-current rating and utility release.",
    keywords: ["service upgrade", "200 amp", "panel upgrade", "meter"],
  },
  {
    id: "PERMIT-R07",
    section: "Permits",
    title: "EV charging equipment",
    detail:
      "Electrical permit, load calculation or an energy-management system, CEC Article 625, CALGreen and utility programme rules.",
    keywords: ["EV charger", "EVSE", "Tesla charger", "car charger"],
  },
  {
    id: "PERMIT-R08",
    section: "Permits",
    title: "Solar photovoltaic",
    detail:
      "Electrical and building permit, structural review where applicable, CEC Articles 690 and 705, rapid shutdown, fire review, utility interconnection and permission to operate.",
    keywords: ["solar", "PV", "rapid shutdown", "interconnection"],
  },
  {
    id: "PERMIT-R09",
    section: "Permits",
    title: "Battery energy storage",
    detail:
      "Electrical, building and fire permits, CEC Article 706, CFC energy-system provisions, location and clearance rules, and utility interconnection where applicable.",
    keywords: ["battery", "ESS", "Powerwall", "storage"],
  },
  {
    id: "PERMIT-R11",
    section: "Permits",
    title: "Pool, spa, fountain or pump",
    detail:
      "Electrical and often building permit. CEC Article 680, equipotential bonding, GFCI and equipment clearances.",
    keywords: ["pool", "spa", "hot tub", "bonding"],
  },
  {
    id: "PERMIT-C13",
    section: "Permits",
    title: "Change of occupancy or use",
    detail:
      "Triggers a full code analysis: existing-building upgrades, egress, fire alarm, accessibility, service and load, and energy impacts.",
    keywords: ["change of use", "occupancy change", "conversion"],
  },
  {
    id: "PERMIT-C14",
    section: "Permits",
    title: "Special enforcing agencies",
    detail:
      "Public schools, hospitals, state buildings and federal facilities may be controlled by DSA, HCAI, DGS or a federal agency rather than the local building department. Identify the enforcing agency before filing locally.",
    keywords: ["school", "hospital", "DSA", "HCAI", "state building"],
  },

  // ---- Inspections -----------------------------------------------------------
  {
    id: "INSP-RULE",
    section: "Inspections",
    title: "Never cover work before inspection",
    detail:
      "Obtain the local inspection card or list, because names and sequencing vary by jurisdiction.",
    keywords: ["inspection", "cover", "backfill", "before drywall"],
  },
  {
    id: "INSP-KEY",
    section: "Inspections",
    title: "Inspections commonly required",
    detail:
      "Underground/trench before backfill. Under-slab before concrete. Grounding electrode/UFER before concealment. Rough electrical before insulation and drywall. Service/meter release. Above-ceiling before closure. Fire-resistance penetrations before concealment. Pool bonding before concrete. Solar rough and final. ESS/generator. Fire-alarm acceptance. Energy installation and acceptance. Accessibility. Final electrical. Utility release/PTO, which is separate from the city final. Certificate of occupancy.",
    keywords: ["inspection list", "rough in", "final", "UFER"],
  },

  // ---- CEC articles ----------------------------------------------------------
  {
    id: "CEC-ARTICLES",
    section: "CEC articles",
    title: "Article finder",
    detail:
      "90/100/110 definitions, listing, working space, interrupting ratings. 210 branch circuits, GFCI, AFCI. 215/220 feeders and load calculations. 225 outside branch circuits. 230 services. 240/242 overcurrent and surge. 250 grounding and bonding. 300/310 wiring methods and conductors. 312/314 boxes and enclosures. 320/330/334 AC, MC and NM cable. 338/342/344/352/358 SE cable and raceways. 400/404/406/408 cords, switches, receptacles, panels. 410/600 luminaires and signs. 422/424/440 appliances, heating, HVAC. 430/409 motors and control panels. 445/450/480 generators, transformers, batteries. 500–516 hazardous locations. 517/518 health care and assembly. 550–552 manufactured homes and RVs. 555 marinas. 590 temporary. 620 elevators. 625 EV charging. 680 pools and spas. 690 solar PV. 695 fire pumps. 700/701/702 emergency and standby. 705 interconnected sources. 706 energy storage. 708/710 critical operations and stand-alone. 750 energy management. 760 fire alarm. Chapter 8 (800/820/840) communications.",
    keywords: ["which article", "article number", "NEC article"],
  },

  // ---- Safety ----------------------------------------------------------------
  {
    id: "SAFE-IIPP",
    section: "Safety",
    title: "Injury and Illness Prevention Program",
    detail:
      "A written IIPP is required, with responsibilities, inspections, correction, training and records. 8 CCR §§1509 and 3203.",
    source: "https://www.dir.ca.gov/dosh/construction-guide-summary.html",
    keywords: ["IIPP", "safety program", "Cal/OSHA"],
  },
  {
    id: "SAFE-LOTO",
    section: "Safety",
    title: "Lockout and control of hazardous energy",
    detail: "8 CCR §3314 and the applicable 2320-series provisions.",
    keywords: ["lockout", "LOTO", "de-energize"],
  },
  {
    id: "SAFE-LEAD",
    section: "Safety",
    title: "Occupational lead in construction",
    detail:
      "Construction work with potential occupational lead exposure, including electrical renovation. The updated Cal/OSHA standard took effect 1 January 2025. 8 CCR §1532.1.",
    source: "https://www.dir.ca.gov/dosh/Lead/Exposure-Prevention-in-Construction.html",
    keywords: ["lead", "old paint", "1532.1"],
  },
  {
    id: "SAFE-ASB",
    section: "Safety",
    title: "Asbestos in renovation",
    detail:
      "Asbestos exposure in demolition, repair, alteration, maintenance and renovation. 8 CCR §1529. Registration and notification duties under Labor Code §§6501.5–6510 and 8 CCR §§341.6–341.14 depend on material percentage and quantity thresholds.",
    source: "https://www.dir.ca.gov/title8/1529.html",
    keywords: ["asbestos", "popcorn ceiling", "old building"],
  },
  {
    id: "OSHA-JUR",
    section: "Safety",
    title: "Cal/OSHA or federal OSHA",
    detail:
      "California operates an OSHA-approved State Plan covering most private-sector and state/local government work. Federal OSHA retains limited jurisdiction over specified federal, maritime and tribal areas. Identify jurisdiction first.",
    source: "https://www.osha.gov/stateplans/ca",
    keywords: ["OSHA jurisdiction", "state plan"],
  },

  // ---- Environmental ---------------------------------------------------------
  {
    id: "EPA-RRP",
    section: "Environmental",
    title: "Lead renovation, repair and painting rule",
    detail:
      "Compensated renovation disturbing painted surfaces in pre-1978 housing or child-occupied facilities requires firm certification, a certified renovator, lead-safe work practices, pre-renovation education and records. 40 CFR Part 745 Subpart E.",
    source: "https://www.epa.gov/lead/renovation-repair-and-painting-program-contractors",
    keywords: ["RRP", "pre-1978", "lead paint", "drilling walls"],
  },
  {
    id: "EPA-RRP-MINOR",
    section: "Environmental",
    title: "Minor-repair exception limits",
    detail:
      "The minor-repair exception has exclusions. Window replacement, demolition of painted surfaces and prohibited practices are not excused by square footage. 40 CFR §745.82.",
    keywords: ["minor repair", "six square feet", "exception"],
  },
  {
    id: "CA-UW",
    section: "Environmental",
    title: "Universal waste",
    detail:
      "Removed lamps, batteries, electronic devices, mercury equipment and photovoltaic modules are universal waste, with accumulation, labelling, transport and recycler rules. 22 CCR Division 4.5.",
    source: "https://dtsc.ca.gov/universal-waste-fact-sheet/",
    keywords: ["lamp disposal", "ballast", "battery disposal", "universal waste"],
  },
  {
    id: "FED-PCB",
    section: "Environmental",
    title: "PCB ballasts",
    detail:
      "Older fluorescent-light ballasts and other PCB-containing equipment have identification, handling and disposal rules. TSCA; 40 CFR Part 761.",
    keywords: ["PCB", "old ballast", "fluorescent"],
  },

  // ---- Public works ----------------------------------------------------------
  {
    id: "PW-REG",
    section: "Public works",
    title: "DIR registration for public work",
    detail:
      "Contractors and subcontractors must be registered before bidding or performing covered public work. Labor Code §§1725.5, 1771.1.",
    source: "https://dir.ca.gov/Public-Works/Contractors.html",
    keywords: ["public works", "prevailing wage registration"],
  },
  {
    id: "PW-APP",
    section: "Public works",
    title: "Apprenticeship on public works",
    detail:
      "Projects of $30,000 or more generally carry apprenticeship notice, request, ratio and training-contribution obligations, subject to statutory rules and exceptions. Labor Code §1777.5.",
    source: "https://dir.ca.gov/das/publicworks.html",
    keywords: ["apprentice", "$30,000", "DAS 140"],
  },
  {
    id: "FED-DBA",
    section: "Public works",
    title: "Davis-Bacon",
    detail:
      "Federal and federally assisted construction, alteration or repair contracts generally over $2,000 carry wage determinations, payroll and contract-clause obligations. 40 USC §§3141–3148; 29 CFR Parts 1, 3 and 5.",
    source: "https://webapps.dol.gov/elaws/elg/dbra.htm",
    keywords: ["Davis-Bacon", "federal", "prevailing wage"],
  },

  // ---- Records ---------------------------------------------------------------
  {
    id: "RECORDS",
    section: "Records",
    title: "Minimum records to keep",
    detail:
      "Signed contract, notices, cancellation forms and change orders. CSLB licence verification. Worker certification, trainee registration or apprenticeship proof. Permit application, approved plans, calculations, product data, energy forms. Inspection results, correction notices, acceptance tests, final approval. Utility service approval, interconnection agreement, permission to operate. Safety, training and exposure records. EPA RRP records where applicable. Asbestos and lead surveys, notifications and manifests where applicable. Public-works registration, wage determination, apprentice requests and certified payroll where applicable. Photos before concealment and at final.",
    keywords: ["records", "what to keep", "documentation"],
  },
];

/**
 * Rules the assistant must follow when answering from this index.
 *
 * Written as instructions because they are, and kept beside the data so the two
 * cannot drift apart.
 */
export const REFERENCE_RULES = [
  "Answer only from the entries provided. If none of them cover the question, say so and say which authority to ask.",
  "Quote the entry id you used, e.g. LIC-C10, so the answer can be checked.",
  "Never state a licence number, and never claim or deny that anyone is licensed.",
  "Never invent a code section, article number, statute or dollar threshold. If a number is not in an entry, say it is not.",
  "Requirements are address-specific. Local amendments, the fire authority and the serving utility can all be more restrictive than the state code, so say what still has to be checked locally.",
  "An old permit does not prove present compliance, a permit exemption is not a licence exemption, and CSLB licensure does not satisfy DIR electrician certification.",
  `End with: ${REFERENCE_CAVEAT}`,
];
