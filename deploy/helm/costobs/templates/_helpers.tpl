{{/*
Expand the name of the chart.
*/}}
{{- define "costobs.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "costobs.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "costobs.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "costobs.labels" -}}
helm.sh/chart: {{ include "costobs.chart" . }}
{{ include "costobs.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: costobs
{{- end }}

{{/*
Selector labels (instance-wide).
*/}}
{{- define "costobs.selectorLabels" -}}
app.kubernetes.io/name: {{ include "costobs.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Per-component selector labels. Pass a dict: (dict "ctx" . "component" "ingest").
*/}}
{{- define "costobs.componentSelectorLabels" -}}
{{ include "costobs.selectorLabels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Per-component labels.
*/}}
{{- define "costobs.componentLabels" -}}
{{ include "costobs.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
ServiceAccount name to use.
*/}}
{{- define "costobs.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "costobs.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve a fully-qualified image reference for a component.
Usage: include "costobs.image" (dict "ctx" . "image" .Values.ingest.image)
Honors global.imageRegistry prefix and falls back tag -> Chart.AppVersion.
*/}}
{{- define "costobs.image" -}}
{{- $registry := .ctx.Values.global.imageRegistry -}}
{{- $repo := .image.repository -}}
{{- $tag := .image.tag | default .ctx.Chart.AppVersion -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repo $tag -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end }}

{{/*
Image pull policy for a component (component override -> global default).
*/}}
{{- define "costobs.pullPolicy" -}}
{{- default .ctx.Values.global.imagePullPolicy .image.pullPolicy -}}
{{- end }}

{{/*
imagePullSecrets block.
*/}}
{{- define "costobs.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end }}

{{/*
Name of the chart-managed credentials Secret.
*/}}
{{- define "costobs.secretName" -}}
{{- printf "%s-creds" (include "costobs.fullname" .) }}
{{- end }}

{{/*
Bundled-service DNS names.
*/}}
{{- define "costobs.postgres.serviceName" -}}
{{- printf "%s-postgres" (include "costobs.fullname" .) }}
{{- end }}
{{- define "costobs.clickhouse.serviceName" -}}
{{- printf "%s-clickhouse" (include "costobs.fullname" .) }}
{{- end }}

{{/*
========================================================================
Secret resolution helpers.

Each returns a dict the templates use to wire env via Secret refs, with
keys: name (secret name), key (secret data key). This is the single switch
between bundled-service credentials and BYO external secrets.
========================================================================
*/}}

{{/*
Postgres DSN secret ref. When BYO with existingSecret -> that secret/key.
Otherwise the chart-managed creds secret (key postgres-dsn), which is built
from bundled service DNS or from external.dsn.
*/}}
{{- define "costobs.postgres.dsnSecret" -}}
{{- if and (not .Values.postgres.enabled) .Values.postgres.external.existingSecret -}}
{{- dict "name" .Values.postgres.external.existingSecret "key" "postgres-dsn" | toJson -}}
{{- else -}}
{{- dict "name" (include "costobs.secretName" .) "key" "postgres-dsn" | toJson -}}
{{- end -}}
{{- end }}

{{/*
ClickHouse native DSN secret ref.
*/}}
{{- define "costobs.clickhouse.dsnSecret" -}}
{{- if and (not .Values.clickhouse.enabled) .Values.clickhouse.external.existingSecret -}}
{{- dict "name" .Values.clickhouse.external.existingSecret "key" "clickhouse-dsn" | toJson -}}
{{- else -}}
{{- dict "name" (include "costobs.secretName" .) "key" "clickhouse-dsn" | toJson -}}
{{- end -}}
{{- end }}

{{/*
ClickHouse migrate DSN secret ref (golang-migrate hook). For external+existingSecret
we fall back to the clickhouse-dsn key in that secret (the migrate driver accepts it).
*/}}
{{- define "costobs.clickhouse.migrateDsnSecret" -}}
{{- if and (not .Values.clickhouse.enabled) .Values.clickhouse.external.existingSecret -}}
{{- dict "name" .Values.clickhouse.external.existingSecret "key" "clickhouse-dsn" | toJson -}}
{{- else -}}
{{- dict "name" (include "costobs.secretName" .) "key" "clickhouse-migrate-dsn" | toJson -}}
{{- end -}}
{{- end }}

{{/*
ClickHouse HTTP URL secret ref (dashboard).
*/}}
{{- define "costobs.clickhouse.httpUrlSecret" -}}
{{- if and (not .Values.clickhouse.enabled) .Values.clickhouse.external.existingSecret -}}
{{- dict "name" .Values.clickhouse.external.existingSecret "key" "clickhouse-http-url" | toJson -}}
{{- else -}}
{{- dict "name" (include "costobs.secretName" .) "key" "clickhouse-http-url" | toJson -}}
{{- end -}}
{{- end }}

{{/*
Dev API key secret ref.
*/}}
{{- define "costobs.devApiKeySecret" -}}
{{- if .Values.devSeed.existingSecret -}}
{{- dict "name" .Values.devSeed.existingSecret "key" "dev-api-key" | toJson -}}
{{- else -}}
{{- dict "name" (include "costobs.secretName" .) "key" "dev-api-key" | toJson -}}
{{- end -}}
{{- end }}

{{/*
Resolve a stable Postgres password for bundled instance (chart-managed).
Reuses any previously generated password on upgrade to avoid churn.
*/}}
{{- define "costobs.postgres.password" -}}
{{- if .Values.postgres.auth.password -}}
{{- .Values.postgres.auth.password -}}
{{- else -}}
{{- $sec := lookup "v1" "Secret" .Release.Namespace (include "costobs.secretName" .) -}}
{{- if and $sec $sec.data (hasKey $sec.data "postgres-password") -}}
{{- index $sec.data "postgres-password" | b64dec -}}
{{- else -}}
{{- randAlphaNum 24 -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Resolve a stable ClickHouse password for bundled instance (chart-managed).
*/}}
{{- define "costobs.clickhouse.password" -}}
{{- if .Values.clickhouse.auth.password -}}
{{- .Values.clickhouse.auth.password -}}
{{- else -}}
{{- $sec := lookup "v1" "Secret" .Release.Namespace (include "costobs.secretName" .) -}}
{{- if and $sec $sec.data (hasKey $sec.data "clickhouse-password") -}}
{{- index $sec.data "clickhouse-password" | b64dec -}}
{{- else -}}
{{- randAlphaNum 24 -}}
{{- end -}}
{{- end -}}
{{- end }}
