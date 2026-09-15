CREATE FUNCTION scopeflow_protect_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'Approved scope versions are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'WAITING_APPROVAL' AND
    (NEW.document IS DISTINCT FROM OLD.document OR NEW.version <> OLD.version OR NEW.project_id <> OLD.project_id OR NEW.based_on_revision <> OLD.based_on_revision) THEN
    RAISE EXCEPTION 'Withdraw approval before editing a scope';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_scope BEFORE UPDATE OR DELETE ON scopes FOR EACH ROW EXECUTE FUNCTION scopeflow_protect_scope();
--> statement-breakpoint
CREATE FUNCTION scopeflow_protect_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'APPROVED' THEN RAISE EXCEPTION 'Approved change requests are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'WAITING_CLIENT_APPROVAL' AND
    (NEW.review IS DISTINCT FROM OLD.review OR NEW.amount <> OLD.amount OR NEW.request <> OLD.request OR NEW.base_scope_id <> OLD.base_scope_id OR NEW.rates IS DISTINCT FROM OLD.rates) THEN
    RAISE EXCEPTION 'Withdraw approval before editing a change';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_change BEFORE UPDATE OR DELETE ON change_requests FOR EACH ROW EXECUTE FUNCTION scopeflow_protect_change();
