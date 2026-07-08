

export function generateLakeIntro(): string {
  return `If \`LAKE_INTRO\` is \`no\`: say "gstack follows the **Boil the Ocean** principle — do the complete thing when AI makes marginal cost near-zero." Then run:

\`\`\`bash
touch ~/.gstack/.completeness-intro-seen
\`\`\``;
}
