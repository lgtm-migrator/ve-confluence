import {
	ConfluencePage,
	ConfluenceDocument,
} from '#/vendor/confluence/module/confluence';

import G_META from '#/common/meta';

import {
	process,
	lang,
	static_css,
	static_js,
} from '#/common/static';

import {format} from '#/util/intl';

import {
	qs,
	qsa,
	dm_content,
	dm_main_header,
} from '#/util/dom';

import type {SvelteComponent} from 'svelte';

import ControlBar from '#/element/ControlBar/component/ControlBar.svelte';

import DngArtifact from '#/element/DngArtifact/component/DngArtifact.svelte';

import QueryTable from '#/element/QueryTable/component/QueryTable.svelte';

import type XhtmlDocument from '#/vendor/confluence/module/xhtml-document';

import {MmsSparqlQueryTable} from '#/element/QueryTable/model/QueryTable';


import {K_HARDCODED} from '#/common/hardcoded';

import type {Context} from '#/model/Serializable';

import {ObjectStore} from '#/model/ObjectStore';


const S_UUID_V4 = 'xxxxxxxx_xxxx_4xxx_yxxx_xxxxxxxxxxxx';
const R_UUID_V4 = /[xy]/g;

const uuid_v4 = () => {
	let dt_now = Date.now();
	if('undefined' !== typeof performance) dt_now += performance.now();
	return S_UUID_V4.replace(R_UUID_V4, (s) => {
		const x_r = (dt_now + (Math.random()*16)) % 16 | 0;
		dt_now = Math.floor(dt_now / 16);
		return ('x' === s? x_r: ((x_r & 0x3) | 0x8)).toString(16);
	});
};


// write static css
{
	const dm_style = document.createElement('style');
	dm_style.innerHTML = static_css;
	document.body.appendChild(dm_style);
}

// write global js
{
	const dm_script = document.createElement('script');
	dm_script.type = 'text/javascript';
	dm_script.innerHTML = static_js;
	document.body.appendChild(dm_script);
}

/**
 * tuple of a node's corresponding HTML element and a struct with properties to be used later
 */
type Handle = [HTMLElement, Record<string, any>];

interface Correlation {
	/**
	 * svelte component to render in place of directive
	 */
	component: typeof SvelteComponent;

	/**
	 * svelte props to pass to the component's constructor
	 */
	props?: Record<string, any>;
}

interface ViewBundle extends Correlation {
	/**
	 * directive's HTML element in the current DOM
	 */
	anchor: HTMLElement;

	/**
	 * directive's corresponding XML node in the Wiki page's storage XHTML document
	 */
	node: Node;
}

type DirectiveDescriptor = (a_handle: Handle) => Correlation;

interface CorrelationDescriptor {
	storage: string;
	live: string;
	struct?: (ym_node: Node, dm_elmt: HTMLElement) => Record<string, any>;
	directive: DirectiveDescriptor;
}

enum Ve4Error {
	UNKNOWN,
	PERMISSIONS,
	METADATA,
}

enum Ve4ErrorLevel {
	INFO,
	WARN,
	ERROR,
	FATAL,
}

type ControlBarConfig = {
	error?: Ve4Error;
	message?: string;
	props?: Record<string, any>;
};

const P_DNG_WEB_PREFIX = process.env.DOORS_NG_PREFIX;

// for excluding elements that are within active directives
const SX_PARAMETER_ID = `ac:parameter[@ac:name="id"][starts-with(text(),"{SI_VIEW_PREFIX}-")]`;
const SX_EXCLUDE_ACTIVE_DIRECTIVES = /* syntax: xpath */ `[not(ancestor::ac:structured-macro[@ac:name="span"][child::${SX_PARAMETER_ID}])]`;

const A_DIRECTIVE_CORRELATIONS: CorrelationDescriptor[] = [
	// dng web link
	{
		storage: /* syntax: xpath */ `.//a[starts-with(@href,"${P_DNG_WEB_PREFIX}")]${SX_EXCLUDE_ACTIVE_DIRECTIVES}`,
		live: `a[href^="${P_DNG_WEB_PREFIX}"]`,
		directive: ([ym_anchor, g_link]) => ({
			component: DngArtifact,
			props: {
				ym_anchor,
				g_link,
				p_href: ym_anchor.getAttribute('href'),
				s_label: ym_anchor.textContent?.trim() || '',
				g_context: G_CONTEXT,
			},
		}),
	},
];

let K_OBJECT_STORE: ObjectStore;
let k_page: ConfluencePage;
const G_CONTEXT: Context = {} as Context;

const H_PAGE_DIRECTIVES: Record<string, DirectiveDescriptor> = {
	// 'Insert Block View': () => ({component:InsertBlockView}),
	// 'Insert DNG Artifact or Attribute': ([ym_anchor]) => ({
	// 	component: InsertInlineView,
	// 	props: {
	// 		p_url: ym_anchor.getAttribute('href'),
	// 	},
	// }),
	'CAE CED Table Element': ([, g_struct]: [HTMLElement, Record<string, any>]) => {
		const si_uuid = (g_struct.uuid as string) || uuid_v4();

		return {
			component: QueryTable,
			props: {
				k_query_table: new MmsSparqlQueryTable(`page#elements.serialized.queryTable.${si_uuid}`,
					{
						type: 'MmsSparqlQueryTable',
						uuid: si_uuid,
						group: 'dng',
						queryTypePath: 'hardcoded#queryType.sparql.dng.afsr',
						connectionPath: 'document#connection.sparql.mms.dng',
						parameterValues: {},
					},
					G_CONTEXT
				),
			},
		};
	},
};

const xpath_attrs = (a_attrs: string[]) => a_attrs.map(sx => `[${sx}]`).join('');

let k_document: ConfluenceDocument | null;
let k_source: XhtmlDocument;

function control_bar(gc_bar: ControlBarConfig) {
	const g_props = {...gc_bar.props};

	// error is present
	if('number' === typeof gc_bar.error) {
		let s_message = '';
		let xc_level = Ve4ErrorLevel.INFO;

		switch(gc_bar.error) {
			case Ve4Error.PERMISSIONS: {
				s_message = lang.error.page_permissions;
				xc_level = Ve4ErrorLevel.WARN;
				break;
			}

			case Ve4Error.METADATA: {
				s_message = lang.error.page_metadata;
				xc_level = Ve4ErrorLevel.FATAL;
				break;
			}

			case Ve4Error.UNKNOWN:
			default: {
				s_message = lang.error.unknown;
				xc_level = Ve4ErrorLevel.FATAL;
				break;
			}
		}
	}
}

function* correlate(gc_correlator: CorrelationDescriptor): Generator<ViewBundle> {
	// find all matching page nodes
	const a_nodes = k_source.select<Node>(gc_correlator.storage);
	const nl_nodes = a_nodes.length;

	// find all corresponding dom elements
	const a_elmts = qsa(dm_content, gc_correlator.live) as HTMLElement[];

	// mismatch
	if(a_elmts.length !== nl_nodes) {
		// `XPath selection found ${nl_nodes} matches but DOM query selection found ${a_elmts.length} matches`);
		throw new Error(format(lang.error.xpath_dom_mismatch, {
			node_count: nl_nodes,
			element_count: a_elmts.length,
		}));
	}

	// apply struct mapper
	const f_struct = gc_correlator.struct;
	const a_structs = f_struct? a_nodes.map((ym_node, i_node) => f_struct(ym_node, a_elmts[i_node])): [];

	// each match
	for(let i_match = 0; i_match < nl_nodes; i_match++) {
		yield {
			...gc_correlator.directive([a_elmts[i_match], a_structs[i_match]]),
			anchor: a_elmts[i_match],
			node: a_nodes[i_match],
		};
	}
}

function render_component(g_bundle: ViewBundle, b_hide_anchor = false) {
	const dm_anchor = g_bundle.anchor;

	// hide anchor
	if(b_hide_anchor) dm_anchor.style.display = 'none';

	// render component
	new g_bundle.component({
		target: dm_anchor.parentNode as HTMLElement,
		anchor: dm_anchor,
		props: {
			...g_bundle.props || {},
			g_node: g_bundle.node,
			// ...GM_CONTEXT,
		},
	});
}

export async function main(): Promise<void> {
	if('object' !== typeof lang?.basic) {
		throw new Error(`ERROR: No lang file defined! Did you forget to set the environment variables when building?`);
	}

	new ControlBar({
		// target: dm_main.parentElement as HTMLElement,
		// anchor: dm_main,
		target: dm_main_header as HTMLElement,
		anchor: qs(dm_main_header, 'div#navigation'),
		props: {
			g_context: G_CONTEXT,
		},
	});

	// G_CONTEXT.k_page =
	k_page = await ConfluencePage.fromCurrentPage();

	await Promise.allSettled([
		(async() => {
			// fetch page metadata
			const g_meta = await k_page.fetchMetadataBundle(true);

			// get or initialize page metadata
		})(),

		(async() => {
			// page is part of document
			k_document = await k_page.getDocument();
		})(),

		(async() => {
			// load page's XHTML source
			k_source = (await k_page.getContentAsXhtmlDocument())?.value || null;
		})(),
	]);

	// not a document member
	if(!k_document) {
		// exit
		return;
	}

	// initialize object store
	G_CONTEXT.store = new ObjectStore({
		page: k_page,
		document: k_document,
		hardcoded: K_HARDCODED,
	});

	// fetch document metadata
	const gm_document = await k_document.fetchMetadataBundle();

	// no metadata; error
	if(!gm_document) {
		throw new Error(`Document exists but no metadata`);
	}

	// each page directive
	for(const si_page_directive in H_PAGE_DIRECTIVES) {
		const f_directive = H_PAGE_DIRECTIVES[si_page_directive];
		// page refs
		const dg_refs = correlate({
			storage: `.//ri:page${xpath_attrs([
				`@ri:space-key="${G_META.space_key}" or not(@ri:space-key)`,
				`@ri:content-title="${si_page_directive}"`,
			])}`,
			live: `a[href="/display/${G_META.space_key}/${si_page_directive.replace(/ /g, '+')}"]`,
			struct: (ym_node) => {
				const ym_parent = ym_node.parentNode as Node;
				debugger;
				return {
					label: ('ac:link' === ym_parent.nodeName? ym_parent.textContent: '') || si_page_directive,
					// macro_id: (ym_parent 'ac:macro-id')
				};
			},
			directive: f_directive,
		});

		// page link as absolute url
		const p_href = `${G_META.base_url}/display/${G_META.space_key}/${si_page_directive.replace(/ /g, '+')}`;
		const dg_links = correlate({
			storage: `.//a[@href="${p_href}"]`,
			live: `a[href="${p_href}"]`,
			struct: ym_node => ({label:ym_node.textContent}),
			directive: f_directive,
		});

		// each instance
		for(const g_bundle of [...dg_refs, ...dg_links]) {
			render_component(g_bundle, true);
		}
	}

	// each simple directive
	for(const gc_correlator of A_DIRECTIVE_CORRELATIONS) {
		// select all instances of this directive
		const dg_directives = correlate(gc_correlator);

		//
		for(const g_bundle of dg_directives) {
			render_component(g_bundle, true);
		}
	}

	// const _xhtmle = k_doc.builder();
	// _xhtmle('ac:structured-macro', {
	// 	'ac:name': 'span',
	// 	'ac:schema-version': '1',
	// 	'ac:macro-id': si_macro,
	// }, [
	// 	...a_children,
	// 	_macro_param('atlassian-macro-output-type', 'INLINE'),
	// 	_xhtmle('ac:rich-text-body', {}, a_body),
	// ])
}

function dom_ready() {
	console.log('dom ready');
}

// entry point
{
	// kickoff main
	main();

	// document is already loaded
	if(['complete', 'interactive', 'loaded'].includes(document.readyState)) {
		dom_ready();
	}
	// dom content not yet loaded; add event listener
	else {
		document.addEventListener('DOMContentLoaded', () => {
			dom_ready();
		}, false);
	}
}
