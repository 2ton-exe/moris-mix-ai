import { X509Certificate } from 'node:crypto';
import { getCACertificates } from 'node:tls';

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const SESSION_POOLER_HOST_PATTERN = /^aws-\d+-[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/;
const ACCEPTED_SSL_MODES = new Set(['require', 'verify-ca', 'verify-full']);
const PEM_CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export function getSupabaseDatabaseCaCertificates(certificatePem) {
  if (typeof certificatePem !== 'string' || !certificatePem.trim()) {
    throw new Error('Supabase database CA certificate is missing or invalid.');
  }

  const certificateBlocks = certificatePem.match(PEM_CERTIFICATE_PATTERN) ?? [];
  if (!certificateBlocks.length || certificatePem.replace(PEM_CERTIFICATE_PATTERN, '').trim()) {
    throw new Error('Supabase database CA certificate is missing or invalid.');
  }

  for (const block of certificateBlocks) {
    let certificate;
    try {
      certificate = new X509Certificate(block);
    } catch {
      throw new Error('Supabase database CA certificate is missing or invalid.');
    }
    const validFrom = Date.parse(certificate.validFrom);
    const validTo = Date.parse(certificate.validTo);
    if (!certificate.ca || !Number.isFinite(validFrom) || !Number.isFinite(validTo) ||
      validFrom > Date.now() || validTo < Date.now()) {
      throw new Error('Supabase database CA certificate is missing or invalid.');
    }
  }

  return [...getCACertificates('default'), ...certificateBlocks];
}

export function getSupabaseDatabaseConnection(connectionString, projectRef) {
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error('Supabase project reference is invalid.');
  }

  let target;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error('Database connection URL is invalid.');
  }

  if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
    throw new Error('Database connection URL must use PostgreSQL.');
  }

  let username;
  let password;
  try {
    username = decodeURIComponent(target.username);
    password = decodeURIComponent(target.password);
  } catch {
    throw new Error('Database connection credentials are invalid.');
  }

  if (!username || !password || target.pathname !== '/postgres' || target.hash) {
    throw new Error('Database connection URL is incomplete.');
  }

  for (const [name, value] of target.searchParams) {
    if (name !== 'sslmode' || !ACCEPTED_SSL_MODES.has(value)) {
      throw new Error('Database connection URL contains unsupported options.');
    }
  }

  if (target.port !== '5432') {
    throw new Error('Supabase database connections must use port 5432.');
  }

  const directHost = `db.${projectRef}.supabase.co`;
  const isDirect = target.hostname === directHost && username === 'postgres';
  const isSessionPooler = SESSION_POOLER_HOST_PATTERN.test(target.hostname) &&
    username === `postgres.${projectRef}`;

  if (!isDirect && !isSessionPooler) {
    throw new Error('Database connection does not match the configured Supabase project.');
  }

  return {
    host: target.hostname,
    port: 5432,
    user: username,
    password,
    database: 'postgres',
  };
}
