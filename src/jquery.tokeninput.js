/*
 * jQuery Plugin: Tokenizing Autocomplete Text Entry
 * Version 1.1
 *
 * Copyright (c) 2009 James Smith (http://loopj.com)
 * Licensed jointly under the GPL and MIT licenses,
 * choose which one suits your project best!
 *	
 * TH - 2010-08-23 - Added ability to have arbitary tags that don't require a match from the list. 
 * Added requiresMatch options to suppor this. Defaults to original Tokenizing Autocomplete functionality.
 * Also added focusHint so it doesn't always show hint when focusing the input. Again, defaults to orignal functionality.
 */

(function($) {

$.fn.tokenInput = function (url, options) {
    var settings = $.extend({
        url: url,
        hintText: "Type in a search term",
        noResultsText: "No results",
        searchingText: "Searching...",
        searchDelay: 300,
        minChars: 1,
        tokenLimit: null,
        jsonContainer: null,
        method: "GET",
        contentType: "json",
        queryParam: "q",
        onResult: null,
        focusHint: true,		//Added TH - determines if drop-down hint should be shown on input focus.
        requireMatch: true,		//Added TH - determines if a user should be able to add new tags or must match a selection.
        animateDropdown: true,
        suggestedTagsText: "Suggested tags:",
        defaultSuggestTagSize: 14,
        defaultSuggestTagSizeUnit: 'px',
        afterAdd: function() {},
        useClientSideSearch: false
    }, options);

    settings.classes = $.extend({
        tokenList: "token-input-list",
        token: "token-input-token",
        tokenDelete: "token-input-delete-token",
        selectedToken: "token-input-selected-token",
        highlightedToken: "token-input-highlighted-token",
        dropdownWrapper: "token-input-dropdown-wrapper",
        dropdown: "token-input-dropdown",
        dropdownItem: "token-input-dropdown-item",
        dropdownItem2: "token-input-dropdown-item2",
        selectedDropdownItem: "token-input-selected-dropdown-item",
        inputToken: "token-input-input-token",
        suggestedTags: "token-input-suggested-tags",
        suggestedTag: "token-input-suggested-tag"
    }, options.classes);

    return this.each(function () {
        var list = new $.TokenList(this, settings);
    });
};

$.TokenList = function (input, settings) {
    //
    // Variables
    //

    // Input box position "enum"
    var POSITION = {
        BEFORE: 0,
        AFTER: 1,
        END: 2
    };

    // Keys "enum"
    var KEY = {
        BACKSPACE: 8,
        TAB: 9,
        RETURN: 13,
        ESC: 27,
        LEFT: 37,
        UP: 38,
        RIGHT: 39,
        DOWN: 40,
        COMMA: 188
    };

    // Save the tokens
    var saved_tokens = [];
    
    // Keep track of the number of tokens in the list
    var token_count = 0;

    // Basic cache to save on db hits
    var cache = new $.TokenList.Cache();

    // Keep track of the timeout
    var timeout;

    var client_side_data;

    // Create a new text input an attach keyup events
    var input_box = $("<input autocomplete=\"off\" type=\"text\">")
        .attr('id', $(input).attr('id')+'Dynamic')
        .attr('name', $(input).attr('id')+'Dynamic')
    	.css({
            outline: "none"
        })
        .focus(function () {
            if (settings.focusHint && (settings.tokenLimit == null || settings.tokenLimit != token_count)) {
                show_dropdown_hint();
            }
            
            if (settings.useClientSideSearch && !client_side_data) {
              client_side_data = [];
              var http_method = settings.method.toLowerCase();
        		  $[http_method](settings.url, {}, prepare_client_side_data, settings.contentType);
            }
        })
        .blur(function () {
            hide_dropdown();
        })
        .keydown(function (event) {
            var previous_token;
            var next_token;

            switch(event.keyCode) {
                case KEY.LEFT:
                case KEY.RIGHT:
                case KEY.UP:
                case KEY.DOWN:
                	console.log('keydown');
                    if(!$(this).val()) {
                        previous_token = input_token.prev();
                        next_token = input_token.next();

                        if((previous_token.length && previous_token.get(0) === selected_token) || (next_token.length && next_token.get(0) === selected_token)) {
                            // Check if there is a previous/next token and it is selected
                            if(event.keyCode == KEY.LEFT || event.keyCode == KEY.UP) {
                                deselect_token($(selected_token), POSITION.BEFORE);
                            } else {
                                deselect_token($(selected_token), POSITION.AFTER);
                            }
                        } else if((event.keyCode == KEY.LEFT || event.keyCode == KEY.UP) && previous_token.length) {
                            // We are moving left, select the previous token if it exists
                            select_token($(previous_token.get(0)));
                        } else if((event.keyCode == KEY.RIGHT || event.keyCode == KEY.DOWN) && next_token.length) {
                            // We are moving right, select the next token if it exists
                            select_token($(next_token.get(0)));
                        }
                    } else {
                        var dropdown_item = null;

                        if(event.keyCode == KEY.DOWN || event.keyCode == KEY.RIGHT) {
                            dropdown_item = $(selected_dropdown_item).next();
                        } else {
                            dropdown_item = $(selected_dropdown_item).prev();
                        }

                        if(dropdown_item.length) {
                            select_dropdown_item(dropdown_item);
                        }
                        return false;
                    }
                    break;

                case KEY.BACKSPACE:
                    previous_token = input_token.prev();

                    if(!$(this).val().length) {
                        if(selected_token) {
                            delete_token($(selected_token));
                        } else if(previous_token.length) {
                            select_token($(previous_token.get(0)));
                        }

                        return false;
                    } else if($(this).val().length == 1) {
                        hide_dropdown();
                    } else {
                        // set a timeout just long enough to let this function finish.
                        setTimeout(function(){do_search(false);}, 5);
                    }
                    break;

                case KEY.TAB:
                case KEY.RETURN:
                case KEY.COMMA:
          
          // Submit form if user hits return a second time
          if(event.keyCode == KEY.RETURN && $(this).val() == "") {
            parentForm[0].submit();
            return false;
          }
          
					if(selected_dropdown_item) {
						add_existing_token($(selected_dropdown_item));
						return false;
					} else {
						add_new_token($(this).val());
						return false;
					}
					break;

                case KEY.ESC:
                  hide_dropdown();
                  return true;

                default:
                    if(is_printable_character(event.keyCode)) {
                      // set a timeout just long enough to let this function finish.
                      setTimeout(function(){do_search(false);}, 5);
                    }
                    break;
            }
        });

    // Keep a reference to the original input box
    var hidden_input = $(input)
                           .hide()
                           .focus(function () {
                               input_box.focus();
                           })
                           .blur(function () {
                               input_box.blur();
                           });

    // Keep a reference to the parent form
    // Collect the stray arbitrary tags before the parent form submits
    var parentForm = hidden_input.parents('form')
                        .submit(function(){
                          add_new_token(input_box.val());
                        });
    
    // Keep a reference to the selected token and dropdown item
    var selected_token = null;
    var selected_dropdown_item = null;

    // The list to store the token items in
    var token_list = $("<ul />")
        .addClass(settings.classes.tokenList)
        .insertAfter(hidden_input)
        .click(function (event) {
            var li = get_element_from_event(event, "li");
            if(li && li.get(0) != input_token.get(0)) {
                toggle_select_token(li);
                return false;
            } else {
                input_box.focus();

                if(selected_token) {
                    deselect_token($(selected_token), POSITION.END);
                }
            }
        })
        .mouseover(function (event) {
            var li = get_element_from_event(event, "li");
            if(li && selected_token !== this) {
                li.addClass(settings.classes.highlightedToken);
            }
        })
        .mouseout(function (event) {
            var li = get_element_from_event(event, "li");
            if(li && selected_token !== this) {
                li.removeClass(settings.classes.highlightedToken);
            }
        })
        .mousedown(function (event) {
            // Stop user selecting text on tokens
            var li = get_element_from_event(event, "li");
            if(li){
                return false;
            }
        });


    // The list to store the dropdown items in
    var dropdown = $("<div>")
        .addClass(settings.classes.dropdown)
        .insertAfter(token_list)
        .hide();
        
    dropdown.wrap("<div class='"+ settings.classes.dropdownWrapper +"' />");    

    // The token holding the input box
    var input_token = $("<li />")
        .addClass(settings.classes.inputToken)
        .appendTo(token_list)
        .append(input_box);

    init_list(hidden_input);
    
    suggestedTags = settings.suggestedTags;
	if(suggestedTags && suggestedTags.length) {
		
	    var suggested_tags_container = $('<div />')
			.addClass(settings.classes.suggestedTags)
			.insertAfter(dropdown);
	
		var suggested_tags_label = $('<p />')
			.appendTo(suggested_tags_container)	
			.text(settings.suggestedTagsText);
		
		var suggested_tags = $("<ul />")
			.appendTo(suggested_tags_container)
			.click(function(event) {
				var li = get_element_from_event(event, "li");
				add_new_token($('a', li).text());
				li.remove();
				
				//Should the whole ul be removed?
				if($('li',this).length==0) {
					$(suggested_tags_container).remove();
				}
				return false;
				
			});
		
	    init_suggestedTags();
	
	}
	
    //
    // Functions
    //


    // Pre-populate list if items exist
    function init_list (token_element) {
        
    	li_data = settings.prePopulate;

        //TH - If prepopulate was passed in as true and not an array of tags, just build the array from existing field value.
    	//This could do with being improved because it just uses the value as both the name and the id.
        if(li_data && !li_data.length) {

        	//convert tag string into tag array that the tokenizer can consume
            var rawTags = $(token_element).val().split(',');
            //[{"id":"856","name":"House"},]
            var tags = [];
            for(var i=0, len = rawTags.length; i < len; i++) {
        		var tag = rawTags[i];
        		if (tag.length) tags[i] = {id: tag, name: tag};
            }
            //clear the text
            $(token_element).attr('value', '');
            li_data = tags;
        }
        
        if(li_data && li_data.length) {
            li_data.each(function(item) {
                var this_token = $("<li><p>"+item.name+"</p> </li>")
                    .addClass(settings.classes.token)
                    .insertBefore(input_token);

                $("<span>x</span>")
                    .addClass(settings.classes.tokenDelete)
                    .appendTo(this_token)
                    .click(function () {
                        delete_token($(this).parent());
                        return false;
                    });

                $.data(this_token.get(0), "tokeninput", {"id": item.id, "name": item.name});

                // Clear input box and make sure it keeps focus
                input_box
                    .val("")
                    .focus();

                // Don't show the help dropdown, they've got the idea
                hide_dropdown();

                // Save this token id
                var id_string = item.id + ","
                hidden_input.val(hidden_input.val() + id_string);
            });
        }
    }
    
    /**
     * TH - Adds suggested tags cloud
     */
    function init_suggestedTags() {
    	
    	li_data = settings.suggestedTags;
    	if(li_data && li_data.length) {
	    	
    		for(var i in li_data) {
	    		
    			suggestedTag = li_data[i].name;
    			if($('li p', token_list).filter(":contains('" + suggestedTag + "')").length==0) {
    			
		    		/*size adjust will increase/decrease tag size*/
		    		var sizeAdjust = 0;
		    		if(typeof(li_data[i].size) != 'undefined') {
		    			sizeAdjust = li_data[i].size;
		    		}
		    		
		    		var this_token = $('<li><a href="#" style="font-size: ' + (settings.defaultSuggestTagSize+sizeAdjust) + settings.defaultSuggestTagSizeUnit + '">'+suggestedTag+'</a></li>')
	                .addClass(settings.classes.suggestedTag)
	                .appendTo(suggested_tags);
		    		
    			}
    		
	        }
    		
    		if($('li',suggested_tags).length==0) {
				$(suggested_tags_container).remove();
			}
    	 }
    	
    }

    function is_printable_character(keycode) {
        if((keycode >= 48 && keycode <= 90) ||      // 0-1a-z
           (keycode >= 96 && keycode <= 111) ||     // numpad 0-9 + - / * .
           (keycode >= 186 && keycode <= 192) ||    // ; = , - . / ^
           (keycode >= 219 && keycode <= 222)       // ( \ ) '
          ) {
              return true;
          } else {
              return false;
          }
    }

    // Get an element of a particular type from an event (click/mouseover etc)
    function get_element_from_event (event, element_type) {
        var target = $(event.target);
        var element = null;

        if(target.is(element_type)) {
            element = target;
        } else if(target.parent(element_type).length) {
            element = target.parent(element_type+":first");
        }

        return element;
    }

    // Inner function to a token to the list
    function insert_token(id, value) {
      var this_token = $("<li><p>"+ value +"</p> </li>")
      .addClass(settings.classes.token)
      .insertBefore(input_token);

      //TH - added to prevent search getting triggered unnecessarily.
      clearTimeout(timeout);
      
      // The 'delete token' button
      $("<span>x</span>")
          .addClass(settings.classes.tokenDelete)
          .appendTo(this_token)
          .click(function () {
              delete_token($(this).parent());
              return false;
          });

      $.data(this_token.get(0), "tokeninput", {"id": id, "name": value});

      settings.afterAdd.call(this);
      
      return this_token;
    }

    // Add a token to the token list based on user input
    function add_existing_token (item) {
        
    	var li_data = $.data(item.get(0), "tokeninput");
        var this_token = insert_token(li_data.id, li_data.name);

        // Clear input box and make sure it keeps focus
        input_box
            .val("")
            .focus();

        // Don't show the help dropdown, they've got the idea
        hide_dropdown();

        // Save this token id
        var id_string = li_data.id + ","
        hidden_input.val(hidden_input.val() + id_string);
        
        token_count++;
        
        if(settings.tokenLimit != null && settings.tokenLimit >= token_count) {
            input_box.hide();
            hide_dropdown();
        }
    }
    
    //Added TH - This is for adding a token that doesn't exist in the list. Could do with drying this up because it's very similar to add_existing_token.
    function add_new_token (label) {
    	
    	if($.trim(label) == '') {
    		return false;
    	}
    	
        var this_token = insert_token(label, label);

        // Clear input box and make sure it keeps focus
        input_box
            .val("")
            .focus();

        // Don't show the help dropdown, they've got the idea
        hide_dropdown();

        // Save this token id
        var id_string = label + ","
        hidden_input.val(hidden_input.val() + id_string);
        
        token_count++;
        
        if(settings.tokenLimit != null && settings.tokenLimit >= token_count) {
            input_box.hide();
            hide_dropdown();
        }
        
    }

    // Select a token in the token list
    function select_token (token) {
        token.addClass(settings.classes.selectedToken);
        selected_token = token.get(0);

        // Hide input box
        input_box.val("");

        // Hide dropdown if it is visible (eg if we clicked to select token)
        hide_dropdown();
    }

    // Deselect a token in the token list
    function deselect_token (token, position) {
        token.removeClass(settings.classes.selectedToken);
        selected_token = null;

        if(position == POSITION.BEFORE) {
            input_token.insertBefore(token);
        } else if(position == POSITION.AFTER) {
            input_token.insertAfter(token);
        } else {
            input_token.appendTo(token_list);
        }

        // Show the input box and give it focus again
        input_box.focus();
    }

    // Toggle selection of a token in the token list
    function toggle_select_token (token) {
        if(selected_token == token.get(0)) {
            deselect_token(token, POSITION.END);
        } else {
            if(selected_token) {
                deselect_token($(selected_token), POSITION.END);
            }
            select_token(token);
        }
    }

    // Delete a token from the token list
    function delete_token (token) {
        // Remove the id from the saved list
        var token_data = $.data(token.get(0), "tokeninput");

        // Delete the token
        token.remove();
        selected_token = null;

        // Show the input box and give it focus again
        input_box.focus();

        // Delete this token's id from hidden input
        var str = hidden_input.val()
        var start = str.indexOf(token_data.id+",");
        var end = str.indexOf(",", start) + 1;

        if(end >= str.length) {
            hidden_input.val(str.slice(0, start));
        } else {
            hidden_input.val(str.slice(0, start) + str.slice(end, str.length));
        }
        
        token_count--;
        
        if (settings.tokenLimit != null) {
            input_box
                .show()
                .val("")
                .focus();
        }
    }

    // Hide and clear the results dropdown
    function hide_dropdown () {
        dropdown.hide().empty();
        selected_dropdown_item = null;
    }

    function show_dropdown_searching () {
        hide_dropdown();
        dropdown
            .html("<p>"+settings.searchingText+"</p>")
            .show();
    }

    function show_dropdown_hint () {
        dropdown
            .html("<p>"+settings.hintText+"</p>")
            .show();
    }

    // Highlight the query part of the search term
	function highlight_term(value, term) {
		return value.replace(new RegExp("(?![^&;]+;)(?!<[^<>]*)(" + term + ")(?![^<>]*>)(?![^&;]+;)", "gi"), "<b>$1</b>");
	}

    // Populate the results dropdown with some results
    function populate_dropdown (query, results) {
        if(results.length) {
            dropdown.empty();
            var dropdown_ul = $("<ul>")
                .appendTo(dropdown)
                .mouseover(function (event) {
                    select_dropdown_item(get_element_from_event(event, "li"));
                })
                .mousedown(function (event) {
                    add_existing_token(get_element_from_event(event, "li"));
                    return false;
                })
                .hide();

            for(var i in results) {
                if (results.hasOwnProperty(i)) {
                    var this_li = $("<li>"+highlight_term(results[i].name, query)+"</li>")
                                      .appendTo(dropdown_ul);

                    if(i%2) {
                        this_li.addClass(settings.classes.dropdownItem);
                    } else {
                        this_li.addClass(settings.classes.dropdownItem2);
                    }

                    if(i == 0) {
                        select_dropdown_item(this_li);
                    }

                    $.data(this_li.get(0), "tokeninput", {"id": results[i].id, "name": results[i].name});
                }
            }

            dropdown.show();
            if (settings.animateDropdown)
              dropdown_ul.slideDown("fast");
            else
              dropdown_ul.show();

        } else {
            hide_dropdown();
            if (settings.noResultsText)
              dropdown.html("<p>"+settings.noResultsText+"</p>").show();
        }
    }

    // Highlight an item in the results dropdown
    function select_dropdown_item (item) {
        if(item) {
            if(selected_dropdown_item) {
                deselect_dropdown_item($(selected_dropdown_item));
            }

            item.addClass(settings.classes.selectedDropdownItem);
            selected_dropdown_item = item.get(0);
        }
    }

    // Remove highlighting from an item in the results dropdown
    function deselect_dropdown_item (item) {
        item.removeClass(settings.classes.selectedDropdownItem);
        selected_dropdown_item = null;
    }

    // Do a search and show the "searching" dropdown if the input is longer
    // than settings.minChars
    function do_search(immediate) {
        var query = input_box.val().toLowerCase();

        if (query && query.length) {
            if(selected_token) {
                deselect_token($(selected_token), POSITION.AFTER);
            }
            
            if (query.length >= settings.minChars) {
                if (settings.searchingText)
                  show_dropdown_searching();
                if (immediate) {
                    run_search(query);
                } else {
                    clearTimeout(timeout);
                    timeout = setTimeout(function(){run_search(query);}, settings.searchDelay);
                }
            } else {
                hide_dropdown();
            }
        }
    }

    // Do the actual search
    function run_search(query) {
        
    	if(query=='') {
    		hide_dropdown();
    		return false;
    	}
    	
    	var cached_results = cache.get(query);
        if(cached_results) {
            populate_dropdown(query, cached_results);
        } else {
			var queryStringDelimiter = settings.url.indexOf("?") < 0 ? "?" : "&";
			var callback = function(results) {
			  if($.isFunction(settings.onResult)) {
			      results = settings.onResult.call(this, results);
			  }
              cache.add(query, settings.jsonContainer ? results[settings.jsonContainer] : results);
              populate_dropdown(query, settings.jsonContainer ? results[settings.jsonContainer] : results);
            
              //TH - added to make sure we don't show results if there was no query. This can happen due to a race condition inserting tockens.
              if($.trim(input_box.val()) == '') {
            	  hide_dropdown();
              }
              
			};
        
        if(settings.useClientSideSearch) {
          callback(search_client_side_data(query));
        } else if( settings.method == "POST" ) {
			    $.post(settings.url + queryStringDelimiter + settings.queryParam + "=" + query, {}, callback, settings.contentType);
		    } else {
		      $.get(settings.url + queryStringDelimiter + settings.queryParam + "=" + query, {}, callback, settings.contentType);
		    }
        }
    }
    
    function prepare_client_side_data(results) {
      client_side_data = [];
      $.each(results, function(i,res){
        res.searchable_string = (res.name + "--" + res.id).toLowerCase();
        client_side_data.push(res);
      });
    }

    function search_client_side_data(query) {
      var lowerQuery = query.toLowerCase();
      var results = []
      $.each(client_side_data, function(i,data) {
        if(data.searchable_string.indexOf(query) != -1)
          results.push(data)
      })
      return results
    }
};


// Really basic cache for the results
$.TokenList.Cache = function (options) {
    var settings = $.extend({
        max_size: 50
    }, options);

    var data = {};
    var size = 0;

    var flush = function () {
        data = {};
        size = 0;
    };

    this.add = function (query, results) {
        if(size > settings.max_size) {
            flush();
        }

        if(!data[query]) {
            size++;
        }

        data[query] = results;
    };

    this.get = function (query) {
        return data[query];
    };
};

})(jQuery);