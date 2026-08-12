/** @jsxImportSource @opentui/solid */

export function PersonaPromptIndicator(props: {
  displayName: string | null
  color: string | null
}) {
  return (
    <box flexDirection="row" gap={1}>
      {props.displayName ? (
        <text fg={props.color ?? "#22c55e"}>
          <b>{props.displayName}</b>
        </text>
      ) : null}
    </box>
  )
}
