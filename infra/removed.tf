# Cloud SQL's databases and user are *forgotten*, not destroyed (ADR-0021,
# 2026-10 amendment).
#
# Deleting a database or a user through the Cloud SQL API needs a running
# instance, and this one has been stopped since the Firestore cutover. Left to
# itself, Terraform would try to drop each of these before the instance and
# fail on the first. Forgetting them lets the instance deletion take them along,
# which is what deleting an instance does anyway.
#
# These blocks only act on the apply that deletes the instance. Once that apply
# has run they match nothing in state and are safe to delete.

removed {
  from = google_sql_database.cvmaker
  lifecycle {
    destroy = false
  }
}

removed {
  from = google_sql_database.admin
  lifecycle {
    destroy = false
  }
}

removed {
  from = google_sql_user.cvmaker
  lifecycle {
    destroy = false
  }
}
