export type JobStatus = "In progress" | "Scheduled" | "Pending" | "Completed";

export type JobMaterial = {
  name: string;
  quantity: number;
  unit: string;
  estimatedUnitPrice: number;
  truckStock: number;
  searchTerm: string;
};

export type JobDocument = {
  name: string;
  kind: "Photo" | "Permit" | "Estimate" | "Panel schedule";
  updated: string;
};

export type PilotJob = {
  id: string;
  date: string;
  dateLabel: string;
  time: string;
  endTime: string;
  customer: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  workType: string;
  summary: string;
  status: JobStatus;
  technician: string;
  technicianInitials: string;
  accessNotes: string;
  serviceNotes: string;
  coordinates: { lat: number; lng: number };
  documents: JobDocument[];
  materials: JobMaterial[];
};

export type PilotInvoice = {
  id: string;
  customer: string;
  amount: number;
  status: "Paid" | "Unpaid" | "Overdue";
  due: string;
  jobId: string;
};

const commonDocuments: JobDocument[] = [
  { name: "Customer intake notes", kind: "Estimate", updated: "Today" },
  { name: "Service panel photo", kind: "Photo", updated: "Today" },
];

export const pilotJobs: PilotJob[] = [
  {
    id: "1045",
    date: "2026-08-03",
    dateLabel: "Mon, Aug 3",
    time: "8:00 AM",
    endTime: "10:00 AM",
    customer: "Smith Residence",
    contactName: "John Smith",
    phone: "(805) 555-0168",
    email: "john.smith@example.com",
    address: "123 Maple Street",
    city: "Santa Maria, CA 93454",
    workType: "Panel upgrade",
    summary: "Upgrade the existing service panel to 200A and review space for a future EV charger.",
    status: "In progress",
    technician: "Mike Davis",
    technicianInitials: "MD",
    accessNotes: "Driveway parking is available. Panel is on the west side of the garage.",
    serviceNotes: "Customer requested the service remain available until the planned shutdown.",
    coordinates: { lat: 34.953, lng: -120.435 },
    documents: [
      ...commonDocuments,
      { name: "Panel replacement permit", kind: "Permit", updated: "Yesterday" },
      { name: "Existing panel schedule", kind: "Panel schedule", updated: "Yesterday" },
    ],
    materials: [
      { name: "200A main breaker panel", quantity: 1, unit: "each", estimatedUnitPrice: 289, truckStock: 0, searchTerm: "200 amp main breaker panel" },
      { name: "AFCI breaker 20A", quantity: 2, unit: "each", estimatedUnitPrice: 59.98, truckStock: 1, searchTerm: "20 amp AFCI breaker" },
      { name: "Grounding electrode conductor", quantity: 30, unit: "ft", estimatedUnitPrice: 1.45, truckStock: 18, searchTerm: "bare copper grounding wire" },
    ],
  },
  {
    id: "1046",
    date: "2026-08-03",
    dateLabel: "Mon, Aug 3",
    time: "10:30 AM",
    endTime: "12:00 PM",
    customer: "Johnson Commercial",
    contactName: "Dana Johnson",
    phone: "(805) 555-0142",
    email: "dana@johnsoncommercial.example",
    address: "456 Oak Avenue",
    city: "Arroyo Grande, CA 93420",
    workType: "Lighting retrofit",
    summary: "Replace warehouse fluorescent fixtures with dimmable LED high-bay fixtures.",
    status: "Scheduled",
    technician: "Jordan Ruiz",
    technicianInitials: "JR",
    accessNotes: "Check in at the loading dock office. Ladder access is clear after 10:00 AM.",
    serviceNotes: "Phase one covers the west aisle only.",
    coordinates: { lat: 35.121, lng: -120.588 },
    documents: [...commonDocuments, { name: "Lighting layout", kind: "Estimate", updated: "Aug 1" }],
    materials: [
      { name: "LED high-bay fixture", quantity: 6, unit: "each", estimatedUnitPrice: 129, truckStock: 6, searchTerm: "LED high bay light 150 watt" },
      { name: "0–10V dimmer", quantity: 2, unit: "each", estimatedUnitPrice: 44.98, truckStock: 1, searchTerm: "0-10V dimmer switch" },
    ],
  },
  {
    id: "1047",
    date: "2026-08-03",
    dateLabel: "Mon, Aug 3",
    time: "1:00 PM",
    endTime: "3:00 PM",
    customer: "Williams Home",
    contactName: "Riley Williams",
    phone: "(805) 555-0189",
    email: "riley.williams@example.com",
    address: "789 Pine Road",
    city: "Nipomo, CA 93444",
    workType: "EV charger install",
    summary: "Install a customer-supplied Level 2 EV charger on the garage wall.",
    status: "Scheduled",
    technician: "Maya Stone",
    technicianInitials: "MS",
    accessNotes: "Dog will be secured. Use the right-side gate to reach the garage panel.",
    serviceNotes: "Panel photo shows two open spaces; verify load calculation onsite.",
    coordinates: { lat: 35.039, lng: -120.483 },
    documents: [...commonDocuments, { name: "EV charger specification", kind: "Estimate", updated: "Aug 2" }],
    materials: [
      { name: "50A GFCI breaker", quantity: 1, unit: "each", estimatedUnitPrice: 119, truckStock: 0, searchTerm: "50 amp GFCI breaker" },
      { name: "6/3 NM-B cable", quantity: 50, unit: "ft", estimatedUnitPrice: 4.2, truckStock: 24, searchTerm: "6/3 Romex wire" },
    ],
  },
  {
    id: "1048",
    date: "2026-08-03",
    dateLabel: "Mon, Aug 3",
    time: "3:30 PM",
    endTime: "4:30 PM",
    customer: "Davis Residence",
    contactName: "Taylor Davis",
    phone: "(805) 555-0121",
    email: "taylor.davis@example.com",
    address: "101 Cedar Lane",
    city: "Oceano, CA 93445",
    workType: "Outlet diagnostic",
    summary: "Diagnose two kitchen receptacles that stopped working after a countertop appliance was used.",
    status: "Pending",
    technician: "Alex Brooks",
    technicianInitials: "AB",
    accessNotes: "Street parking. Customer will meet the technician at the front door.",
    serviceNotes: "No smoke, heat, or active sparking reported during intake.",
    coordinates: { lat: 35.102, lng: -120.609 },
    documents: commonDocuments,
    materials: [
      { name: "20A tamper-resistant GFCI", quantity: 2, unit: "each", estimatedUnitPrice: 22.98, truckStock: 1, searchTerm: "20 amp tamper resistant GFCI outlet" },
      { name: "12/2 NM-B cable", quantity: 25, unit: "ft", estimatedUnitPrice: 1.08, truckStock: 18, searchTerm: "12/2 Romex wire" },
    ],
  },
  {
    id: "1049",
    date: "2026-08-04",
    dateLabel: "Tue, Aug 4",
    time: "9:00 AM",
    endTime: "11:00 AM",
    customer: "Martinez Residence",
    contactName: "Elena Martinez",
    phone: "(805) 555-0115",
    email: "elena.martinez@example.com",
    address: "42 Mesa View Drive",
    city: "San Luis Obispo, CA 93401",
    workType: "Generator estimate",
    summary: "Site walk and load review for a standby generator estimate.",
    status: "Scheduled",
    technician: "Mike Davis",
    technicianInitials: "MD",
    accessNotes: "Call on arrival for gate access.",
    serviceNotes: "Estimate visit only; no shutdown planned.",
    coordinates: { lat: 35.282, lng: -120.659 },
    documents: commonDocuments,
    materials: [],
  },
  {
    id: "1050",
    date: "2026-08-05",
    dateLabel: "Wed, Aug 5",
    time: "8:30 AM",
    endTime: "10:00 AM",
    customer: "Coastal Dental",
    contactName: "Morgan Lee",
    phone: "(805) 555-0194",
    email: "office@coastaldental.example",
    address: "880 Grand Avenue",
    city: "Grover Beach, CA 93433",
    workType: "Dedicated circuit",
    summary: "Install a dedicated 20A circuit for new sterilization equipment.",
    status: "Scheduled",
    technician: "Jordan Ruiz",
    technicianInitials: "JR",
    accessNotes: "Work must be completed before the first patient at 11:00 AM.",
    serviceNotes: "Coordinate any shutdown with the office manager.",
    coordinates: { lat: 35.121, lng: -120.621 },
    documents: commonDocuments,
    materials: [
      { name: "20A commercial receptacle", quantity: 1, unit: "each", estimatedUnitPrice: 12.98, truckStock: 4, searchTerm: "20 amp commercial grade receptacle" },
      { name: "12/2 NM-B cable", quantity: 75, unit: "ft", estimatedUnitPrice: 1.08, truckStock: 18, searchTerm: "12/2 Romex wire" },
    ],
  },
];

export const pilotInvoices: PilotInvoice[] = [
  { id: "INV-10024", customer: "Smith Residence", amount: 3789.32, status: "Paid", due: "Paid today", jobId: "1045" },
  { id: "INV-10023", customer: "Johnson Commercial", amount: 4250, status: "Unpaid", due: "Due Aug 10", jobId: "1046" },
  { id: "INV-10018", customer: "Harper Residence", amount: 950, status: "Overdue", due: "12 days overdue", jobId: "1048" },
  { id: "INV-10012", customer: "Coastal Dental", amount: 1280, status: "Paid", due: "Paid Jul 31", jobId: "1050" },
];

export const serviceBase = {
  name: "Pacific Plains Electric",
  address: "Nipomo, CA 93444",
  coordinates: { lat: 35.0428, lng: -120.476 },
};

export const pilotLowesStore = {
  name: "Lowe’s Home Improvement",
  address: "Santa Maria, CA 93455",
  coordinates: { lat: 34.922, lng: -120.436 },
};

export function getPilotJob(id: string) {
  return pilotJobs.find((job) => job.id === id);
}

export function jobNeedsMaterialStop(job: PilotJob) {
  return job.materials.some((material) => material.truckStock < material.quantity);
}

export function buildLowesSearchUrl(searchTerm: string) {
  return `https://www.lowes.com/search?searchTerm=${encodeURIComponent(searchTerm)}`;
}

export function buildGoogleDirectionsUrl(stops: string[]) {
  if (stops.length === 0) return "https://www.google.com/maps/dir/?api=1";
  const [origin, ...destinations] = stops;
  const destination = destinations.at(-1) ?? origin;
  const waypoints = destinations.slice(0, -1);
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildAppleDirectionsUrl(destination: string, origin?: string) {
  const params = new URLSearchParams({ daddr: destination, dirflg: "d" });
  if (origin) params.set("saddr", origin);
  return `https://maps.apple.com/?${params.toString()}`;
}
