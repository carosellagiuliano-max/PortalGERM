const integrationTemplateDatabasePattern =
  /^swisstalenthub_test_tpl_[a-f0-9]{32}$/u;

export function resolveIntegrationTemplateDatabaseName(
  templateDatabaseName: string | undefined,
) {
  if (templateDatabaseName === undefined) return undefined;
  if (!integrationTemplateDatabasePattern.test(templateDatabaseName)) {
    throw new Error("TEST_DATABASE_TEMPLATE_NAME_FORBIDDEN");
  }
  return templateDatabaseName;
}
