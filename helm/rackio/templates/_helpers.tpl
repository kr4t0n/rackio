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
{{- if and .Values.ingress.enabled (not .Values.ingress.hosts) -}}
{{- fail "ingress.enabled is true but ingress.hosts is empty — add at least one entry, e.g. hosts: [{host: rackio.example.com, paths: [{path: /, pathType: Prefix}]}]" -}}
{{- end -}}
{{- range .Values.ingress.hosts -}}
{{- if not .host -}}
{{- fail "every ingress.hosts entry needs a host" -}}
{{- end -}}
{{- if not .paths -}}
{{- fail (printf "ingress host %s has no paths — add e.g. paths: [{path: /, pathType: Prefix}]" .host) -}}
{{- end -}}
{{- end -}}
{{- if and .Values.persistence.enabled .Values.persistence.existingClaim (eq .Values.persistence.existingClaim "") -}}
{{- fail "persistence.existingClaim must be a claim name or left unset" -}}
{{- end -}}
{{- end -}}
