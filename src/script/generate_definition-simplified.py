import argparse
import json
import sys
from pathlib import Path
try:
		import xmlschema
except ImportError:
		print("This script requires the 'xmlschema' package. Install with: pip install xmlschema", file=sys.stderr)
		sys.exit(1)

############## TYPE ##############

def get_type_name(element):
		element_type = getattr(element, "type", None)
		return getattr(element_type, "local_name", None) if element_type is not None else None

############## NAMESPACE ##############

def get_namespace(element):
		if not ":" in element.prefixed_name:
				raise ValueError("Invalid prefixed name")
		element_prefix = element.prefixed_name.split(":")[0]
		return {
				"prefix": '' if element_prefix == 'scl' else element_prefix,
				"namespace": element.target_namespace
		}

############## DOCUMENTATION ##############

def get_documentation(element):
		docs = []
		for annotation in getattr(element, "annotations", []):
				for documentation in getattr(annotation, "documentation", []):
						doc_text = getattr(documentation, "text", None)
						if doc_text:
								docs.append(doc_text.strip())
		return list(dict.fromkeys(docs))

############## PARENTS ##############

def get_parents(existing_parents, new_parent):
	"""
	Merge new_parent into existing_parents array, deduplicating.
	"""
	parents = existing_parents if existing_parents else []
	if new_parent and new_parent not in parents:
		parents.append(new_parent)
	return parents

def merge_parents(existing, incoming):
	for key, value in incoming.items():
		if key in existing:
			existing[key]["parents"] = get_parents(existing[key]["parents"], None)  # ensure not None
			for parent in value["parents"]:
				existing[key]["parents"] = get_parents(existing[key]["parents"], parent)
		else:
			existing[key] = value

############## SUB ELEMENTS ##############

def get_sub_elements(element):
	subelements = []
	content = getattr(getattr(element, "type", None), "content", None)
	if content and hasattr(content, "iter_elements"):
		for child_element in content.iter_elements():
			if getattr(child_element, "name", None):
				subelements.append(child_element.local_name)
	return subelements

############## CONSTRAINTS ##############

# Recursively collect constraints
def get_constraints(element):
	constraints = []
	all_identities = list(getattr(element, "identities", []))
	element_type = getattr(element, "type", None)
	if element_type is not None:
		all_identities.extend(getattr(element_type, "identities", []))
	seen = set()
	for identity in all_identities:
		key = (getattr(identity, "name", None), identity.__class__.__name__)
		if key in seen:
			continue
		seen.add(key)
		selector_path = getattr(getattr(identity, "selector", None), "path", None)
		js_selector, deep = normalize_selector(selector_path)
		attributes = extract_attributes(getattr(identity, "fields", None))
		identity_type = identity.__class__.__name__
		if identity_type == "XsdUnique":
			constraints.append({
				"type": "unique",
				"name": getattr(identity, "local_name", None),
				"selector": js_selector,
				"attributes": attributes,
				"deep": deep,
				"refer": None
			})
		elif identity_type == "XsdKey":
			constraints.append({
				"type": "key",
				"name": getattr(identity, "local_name", None),
				"selector": js_selector,
				"attributes": attributes,
				"deep": deep,
				"refer": None
			})
		elif identity_type == "XsdKeyref":
			constraints.append({
				"type": "keyref",
				"name": getattr(identity, "local_name", None),
				"selector": js_selector,
				"attributes": attributes,
				"deep": deep,
				"refer": getattr(getattr(identity, "refer", None), "local_name", None),
			})
	return constraints

# Normalize selector path(s) to JS-friendly array of dot notation strings
def normalize_selector(selector_path):
	selectors = []
	deep = False
	if selector_path:
			for part in selector_path.split('|'):
					part = part.strip()
					if part.startswith('.//'):
							deep = True
							part = part[4:]
					elif part.startswith('./'):
							part = part[2:]
					part = part.replace('/scl:', '.').replace('/', '.')
					part = part.replace('scl:', '')
					part = part.lstrip('.')
					# Remove any namespace prefix (e.g., scl:Terminal -> Terminal)
					if ':' in part:
							part = part.split(':')[-1]
					selectors.append(part)
	return selectors, deep

# Extract attribute names from identity fields
def extract_attributes(fields):
	attributes = []
	if fields is not None:
		for field in fields:
			field_path = getattr(field, "path", None)
			if field_path and field_path.startswith('@'):
				attributes.append(field_path[1:])
	return attributes

############## XSD PARSER ##############

def walk_element(element, visited_element_ids, parent_name=None, result=None):
	if result is None:
		result = {}
	# Prevent infinite recursion by tracking visited elements by their Python object id
	element_id = id(element)
	if element_id in visited_element_ids:
		return result
	visited_element_ids.add(element_id)

	# Only process elements with a name
	if not getattr(element, "name", None):
		return result
	element_name = element.local_name

	# If element already exists, update parents array using get_parents
	if element_name in result:
		info = result[element_name]
		info["parents"] = get_parents(info["parents"], parent_name)
	else:
		info = {}
		info["type"] = get_type_name(element)
		info["tag"] = element_name
		info['namespace'] = get_namespace(element)
		info["attributes"] = list(element.attributes.keys())
		info["subElements"] = get_sub_elements(element)
		info["constraints"] = get_constraints(element)
		info["documentation"] = get_documentation(element)
		info["parents"] = get_parents([], parent_name)
		result[element_name] = info

	# Recursively process child elements and aggregate results
	content = getattr(getattr(element, "type", None), "content", None)
	if content and hasattr(content, "iter_elements"):
		for child_element in content.iter_elements():
			if getattr(child_element, "name", None):
				walk_element(child_element, visited_element_ids, parent_name=element_name, result=result)
	return result

def walk_schema(schema, visited_schema_ids, visited_element_ids):
	result = {}
	# Walk global elements
	for element in schema.elements.values():
		walk_element(element, visited_element_ids, parent_name=None, result=result)
	# Walk includes/imports
	for included in getattr(schema, "includes", []):
		included_schema = getattr(included, "schema", None)
		if included_schema and id(included_schema) not in visited_schema_ids:
			visited_schema_ids.add(id(included_schema))
			included_results = walk_schema(included_schema, visited_schema_ids, visited_element_ids)
			merge_parents(result, included_results)
	for imported in getattr(schema, "imports", []):
		imported_schema = getattr(imported, "schema", None)
		if imported_schema and id(imported_schema) not in visited_schema_ids:
			visited_schema_ids.add(id(imported_schema))
			imported_results = walk_schema(imported_schema, visited_schema_ids, visited_element_ids)
			merge_parents(result, imported_results)
	return result

def collect_elements(schema):
		visited_schema_ids = set([id(schema)])
		visited_element_ids = set()
		elements = walk_schema(schema, visited_schema_ids, visited_element_ids)
		return elements

############## MAIN ##############

def main():
	parser = argparse.ArgumentParser(description='Extract SCL element names from IEC 61850 XSD and output as JSON')
	parser.add_argument('--entry', required=True, help='Path to entry XSD (e.g., SCL.xsd)')
	parser.add_argument('--out-json', required=True, help='Output JSON file path')
	args = parser.parse_args()

	entry_xsd = Path(args.entry).resolve()
	out_json = Path(args.out_json).resolve()

	base_url = str(entry_xsd.parent)
	try:
		schema = xmlschema.XMLSchema(str(entry_xsd), base_url=base_url)
	except Exception as e:
		print(f"[ERROR] Failed to load schema: {e}")
		sys.exit(1)

	elements = collect_elements(schema)
	try:
		with open(out_json, 'w', encoding='utf-8') as f:
			json.dump(elements, f, indent=2)
	except Exception as e:
		print(f"[ERROR] Failed to write output file: {e}")

if __name__ == '__main__':
	main()
