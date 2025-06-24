import { Trend, Rate } from 'k6/metrics';

// --- Metrics ---
export const pageLoadTime = new Trend('browser_page_load_time');
export const pageLoadSuccess = new Rate('browser_page_load_success');

// Core Web Vitals metrics
export const lcpByTransaction = new Trend('browser_lcp', true);
export const fcpByTransaction = new Trend('browser_fcp', true);
export const clsByTransaction = new Trend('browser_cls', true);
export const ttfbByTransaction = new Trend('browser_ttfb', true);

// Detailed page load timing metrics
export const serverProcessingTime = new Trend('browser_server_processing_time', true);
export const networkTime = new Trend('browser_network_time', true);
export const domProcessingTime = new Trend('browser_dom_processing_time', true);
export const resourceLoadTime = new Trend('browser_resource_load_time', true);
export const scriptExecutionTime = new Trend('browser_script_execution_time', true);
export const scriptParsingTime = new Trend('browser_script_parsing_time', true);
export const criticalRenderingTime = new Trend('browser_critical_rendering_time', true);
export const totalDownloadTime = new Trend('browser_total_download_time', true);
export const criticalPathTime = new Trend('browser_critical_path_time', true);
export const parallelDownloadEfficiency = new Trend('browser_parallel_download_efficiency', true);
export const jsLoadTime = new Trend('browser_js_load_time', true);
export const cssLoadTime = new Trend('browser_css_load_time', true);
export const imgLoadTime = new Trend('browser_img_load_time', true);
export const fontLoadTime = new Trend('browser_font_load_time', true);
export const otherResourceLoadTime = new Trend('browser_other_resource_load_time', true);

// Resource count metrics
export const resourceJs = new Trend('browser_resource_js', true);
export const resourceCss = new Trend('browser_resource_css', true);
export const resourceImg = new Trend('browser_resource_img', true);
export const resourceFont = new Trend('browser_resource_font', true);
export const resourceOther = new Trend('browser_resource_other', true);

// --- Mantle Custom Metrics ---
export const mantle_first_ad_load = new Trend('browser_mantle_first_ad_load', true);
export const mantle_first_ad_render = new Trend('browser_mantle_first_ad_render', true);
export const mantle_first_ad_request = new Trend('browser_mantle_first_ad_request', true);
export const mantle_first_ad_response = new Trend('browser_mantle_first_ad_response', true);
export const mantle_gtm_loaded = new Trend('browser_mantle_gtm_loaded', true);
export const mantle_gpt_loaded = new Trend('browser_mantle_gpt_loaded', true);
export const mantle_scroll_depth = new Trend('browser_mantle_scroll_depth', true);
export const mantle_content_depth_px = new Trend('browser_mantle_content_depth_px', true);
export const mantle_third_party_fired = new Trend('browser_mantle_third_party_fired', true);
export const mantle_deferred_fired = new Trend('browser_mantle_deferred_fired', true);
export const mantle_video_player_loaded = new Trend('browser_mantle_video_player_loaded', true);
export const mantle_ad_refresh_rate = new Trend('browser_mantle_ad_refresh_rate', true);
export const mantle_ad_bidder_amount = new Trend('browser_mantle_ad_bidder_amount', true);
export const mantle_first_scroll = new Trend('browser_mantle_first_scroll', true);
export const mantle_adsrendered = new Trend('browser_mantle_adsrendered', true);
export const mantle_adsviewable = new Trend('browser_mantle_adsviewable', true);
