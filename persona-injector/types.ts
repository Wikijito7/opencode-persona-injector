export interface PersonaAgentConfig {
  prompt: string
  enabled?: boolean  // defaults to true
}

export interface PersonaDefinition {
  displayName: string
  color?: string  // defaults to "#22c55e"
  agents: Record<string, PersonaAgentConfig>
}

export interface PersonaMeta {
  id: string           // filename without extension
  displayName: string
  color: string        // always resolved (defaulted if missing from JSON)
  agents: Record<string, PersonaAgentConfig>
}

export interface PersonaInjectorConfig {
  persona: string | null  // persona id, or null = disabled
}
