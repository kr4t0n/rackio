{{/*
Expand the name of the chart.
*/}}
{{- define "rackio.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
A "fullname" prefix used by every resource. Honors fullnameOverride and
falls back to "<release>-<chart>" so two releases can coexist in one
namespace.
*/}}
{{- define "rackio.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Name of the Secret holding integration credentials — either the one the
chart renders or a pre-existing one the user points at.
*/}}
{{- define "rackio.secretName" -}}
{{- if .Values.integrations.existingSecret -}}
{{- .Values.integrations.existingSecret -}}
{{- else -}}
{{- include "rackio.fullname" . -}}
{{- end -}}
{{- end -}}

{{/*
True when the chart should render its own Secret: only if no existing
Secret is referenced AND at least one credential is set inline.
*/}}
{{- define "rackio.createSecret" -}}
{{- if .Values.integrations.existingSecret -}}
{{- else -}}
{{- $i := .Values.integrations -}}
{{- if or $i.calibre.baseUrl $i.calibre.user $i.calibre.password $i.calendar.icsUrl $i.adguard.baseUrl $i.adguard.user $i.adguard.password -}}
true
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Name of the PVC backing /app/data.
*/}}
{{- define "rackio.pvcName" -}}
{{- if .Values.persistence.existingClaim -}}
{{- .Values.persistence.existingClaim -}}
{{- else -}}
{{- printf "%s-data" (include "rackio.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Common labels shared by every object.
*/}}
{{- define "rackio.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "rackio.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Selector labels — deliberately excludes version/chart so the selector
survives upgrades (k8s rejects mutating a Deployment selector).
*/}}
{{- define "rackio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "rackio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Fully-qualified image reference. Tag falls back to Chart.AppVersion so an
unconfigured chart always pulls the matching app release.
*/}}
{{- define "rackio.image" -}}
{{- $reg := .Values.image.registry | default "docker.io" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s/%s:%s" $reg .Values.image.repository $tag -}}
{{- end -}}

{{/*
Guard rails: fail the install with a useful message rather than
rendering something that silently misbehaves.
*/}}
{{- define "rackio.validate" -}}
{{- if and .Values.ingress.enabled (not .Values.ingress.host) -}}
{{- fail "ingress.enabled is true but ingress.host is empty — set the hostname (with the tailscale operator this becomes the tailnet device name)" -}}
{{- end -}}
{{- if and .Values.persistence.enabled .Values.persistence.existingClaim (eq .Values.persistence.existingClaim "") -}}
{{- fail "persistence.existingClaim must be a claim name or left unset" -}}
{{- end -}}
{{- end -}}
