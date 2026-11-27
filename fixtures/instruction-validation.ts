export const instructionValidationCases = [
  { label: "empty", text: "", accepted: false },
  { label: "whitespace", text: " ", accepted: true },
  { label: "multiline", text: "Simmer.\nServe.", accepted: true },
  { label: "maximum length", text: "x".repeat(2_000), accepted: true },
  { label: "over maximum length", text: "x".repeat(2_001), accepted: false },
];
