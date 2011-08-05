// ==========================================================================
// LinkIt.CanvasView
// ==========================================================================
/*globals G_vmlCanvasManager LinkIt SCUI*/

sc_require('libs/excanvas');

/** @class

  This is the canvas tag that draws the line on the screen

  @extends SC.View
  @author Jonathan Lewis
  @author Evin Grano
  @author Mohammed Taher
  @version 0.1
*/
LinkIt.CanvasView = SC.CollectionView.extend({

  // PUBLIC PROPERTIES

  classNames: ['linkit-canvas'],

  /**
    YES if there are no nodes present on the canvas.  Provided so you can style
    the canvas differently when empty if you want to.
  */
  isEmpty: YES,
  
  /**
    SC.CollectionView property that lets delete keys be detected
  */
  acceptsFirstResponder: YES,

  /**
  */
  canDeleteContent: YES,

  /**
    SC.CollectionView property that allows clearing the selection by clicking
    in an empty area.
  */
  allowDeselectAll: YES,

  /**
    Optional target for an action to be performed upon right-clicking anywhere
    on the canvas.
  */
  contextMenuTarget: null,
  
  /**
    Optional action to be performed when the canvas is right-clicked anywhere.
  */
  contextMenuAction: null,

  /**
    How close you have to click to a line before it is considered a hit
  */
  LINK_SELECTION_FREEDOM: 6,
  
  /**
    Pointer to (most recently) selected link object
  */
  linkSelection: null,

  /**
    Allow multiple selection of links. If allowMultipleSelection is NO (the default),
    only one link may be selected at once (linkSelection) and selectedLinks will be
    an array with 0 or 1 elements. If allowMultipleSelection is YES, the selectedLinks
    array will contain whatever links are selected; linkSelection will always be the
    last link selected, but multiple links will have their isSelected attribute set
    to YES.
  */
  allowMultipleSelection: NO,
  selectedLinks: [],
  
  /**
  */
  displayProperties: ['frame'],
  
  // PUBLIC METHODS

  /**
    Call this to trigger a links refresh
  */
  linksDidChange: function() {
    //console.log('%@.linksDidChange()'.fmt(this));
    this.invokeOnce(this._updateLinks);
  },

  render: function(context, firstTime) {
    var ctx, ce, frame = this.get('frame');
    
    if (firstTime && !SC.browser.msie) {
      context.push('<canvas class="base-layer" width="%@" height="%@">You can\'t use canvas tags</canvas>'.fmt(frame.width, frame.height));
      this._canvasContext = null;
    }

    this.invokeOnce('updateCanvas');
    
    sc_super();
  },
  
  updateCanvas: function() {
    var ce, ctx = this._canvasContext, 
        frame = this.get('clippingFrame');
    if (!ctx){
      ce = this.$('canvas.base-layer');
      ctx = (ce && ce.length > 0) ? ce[0].getContext('2d') : null;
    }
    
    if (ctx) {
      ctx.clearRect(frame.x, frame.y, frame.width + 4, frame.height + 4);      
      this._drawLinks(ctx);
    } else {
      this.set('layerNeedsUpdate', YES) ;
    }
  },
  
  didCreateLayer: function() {
    sc_super();
    if (SC.browser.msie) {
      var frame = this.get('frame');
      var canvas = document.createElement('CANVAS');
      canvas.className = 'base-layer';
      canvas.width = frame.width;
      canvas.height = frame.height;
      this.$().append(canvas);
      canvas = G_vmlCanvasManager.initElement(canvas);
      this._canvasie = canvas;
    }
  },

  didReload: function(invalid) {
    //console.log('%@.didReload()'.fmt(this));
    var viewIndex = {};
    var content = this.get('content') || [];
    var len = content.get('length');
    var node, nodeID, view;
    for (var i = 0; i < len; i++) {
      node = content.objectAt(i);
      nodeID = SC.guidFor(node);
      view = this.itemViewForContentIndex(i);
      viewIndex[nodeID] = view;
    }
    this._nodeViewIndex = viewIndex;
  },

  /**
    Overrides SC.CollectionView.createItemView().
    In addition to creating new view instance, it also overrides the layout
    to position the view according to where the LinkIt.Node API indicates, or
    randomly generated position if that's not present.
  */
  createItemView: function(exampleClass, idx, attrs) {
    var view, frame;
    var layout, position;
    var node = attrs.content;

    if (exampleClass) {
      view = exampleClass.create(attrs);
    }
    else { // if no node view, create a default view with an error message in it
      view = SC.LabelView.create(attrs, {
        layout: { left: 0, top: 0, width: 150, height: 50 },
        value: 'Missing NodeView'
      });
    }

    frame = view.get('frame');
    position = this._getItemPosition(node);

    // generate a random position if it's not present
    if (!position) {
      position = this._genRandomPosition();
      this._setItemPosition(node, position);
    }
    
    // override the layout so we can control positioning of this node view
    layout = { top: position.y, left: position.x, width: frame.width, height: frame.height };
    view.set('layout', layout);
    return view;
  },

  /**
    Override this method from SC.CollectionView to handle link deletion.
    Handles regular item deletion by calling sc_super() first.
  */
  deleteSelection: function() {
    if (this.get('isEditable')) {
      sc_super();
      this.deleteLinkSelection();
    }

    // Always return YES since this becomes the return value of the keyDown() method
    // in SC.CollectionView and we have to signal we are absorbing backspace keys whether
    // we delete anything or not, or the browser will treat it like the Back button.
    return YES;
  },

  /**
    Attempts to delete the link selection if present and possible
  */
  deleteLinkSelection: function() {
    var links = this.get('selectedLinks');
    if (links) {
      links.forEach(function(link) {
        if (link && link.canDelete() && this.get('isEditable')) {
          var startNode = link.get('startNode');
          var endNode = link.get('endNode');
          if (startNode && endNode) {
            startNode.deleteLink(link);
            //   endNode.deleteLink(link);
            // Only need to delete the link once
          }
        }
      });
      this.set('linkSelection', null);
      this.set('selectedLinks', []);
      this.displayDidChange();
    }
  },


  mouseDown: function(evt) {
    var pv, frame, globalFrame, canvasX, canvasY, itemView, menuPane, menuOptions;
    var linkSelection, startNode, endNode, canDelete;

    sc_super();

    // init the drag data
    this._dragData = null;

    if (evt && (evt.which === 3) || (evt.ctrlKey && evt.which === 1)) {
      if (this.get('isEditable')) {
        var selectedLinks = this.get('selectedLinks');
        if (selectedLinks && !this.getPath('selection.length')) {
          menuOptions = [
            { title: "Delete Selected Links".loc(), target: this, action: 'deleteLinkSelection', isEnabled: YES }
          ];

          menuPane = SCUI.ContextMenuPane.create({
            contentView: SC.View.design({}),
            layout: { width: 194, height: 0 },
            itemTitleKey: 'title',
            itemTargetKey: 'target',
            itemActionKey: 'action',
            itemSeparatorKey: 'isSeparator',
            itemIsEnabledKey: 'isEnabled',
            items: menuOptions
          });
        
          menuPane.popup(this, evt);
        }
      }
    }
    else {
      var multiSelect = evt.metaKey && this.get('allowMultipleSelection');
      pv = this.get('parentView');
      frame = this.get('frame');
      globalFrame = pv ? pv.convertFrameToView(frame, null) : frame;
      canvasX = evt.pageX - globalFrame.x;
      canvasY = evt.pageY - globalFrame.y;
      this._selectLink( {x: canvasX, y: canvasY}, multiSelect );

      if (this.get('isEditable')) { // only allow possible drag if this view is editable
        itemView = this.itemViewForEvent(evt);
        
        var selectedViews = this.get('childViews').filter(function(view){
          return (view.get('isSelected'));
        });
        
        var selectedViewsMap = selectedViews.map(function(view){
          return {view: view, position: view.get('layout')};
        })
        
        if (itemView) {
          this._dragData = SC.clone(itemView.get('layout'));
          this._dragData.startPageX = evt.pageX;
          this._dragData.startPageY = evt.pageY;
          this._dragData.view = itemView;
          this._dragData.selectedViews = selectedViewsMap;
          this._dragData.itemFrame = itemView.get('frame'); // note this assumes the item's frame will not change during the drag
          this._dragData.ownerFrame = this.get('frame'); // note this assumes the canvas' frame will not change during the drag
          this._dragData.didMove = NO; // hasn't moved yet; drag will update this
        }
      }
    }
    
    return YES;
  }, 

  mouseDragged: function(evt) {
    var x, y, itemFrame, thisFrame;

    if (this._dragData) {
      this._dragData.didMove = YES; // so that mouseUp knows whether to report the new position.

      // Get width & height of item and the canvas.  Note that this assumes neither will change
      // during the drag.
      itemFrame = this._dragData.itemFrame;
      thisFrame = this._dragData.ownerFrame;
      
      var dx = evt.pageX - this._dragData.startPageX;
      var dy = evt.pageY - this._dragData.startPageY;
      
      this._dragData.selectedViews.forEach(function(viewMap){
        // proposed new position
        x = viewMap.position.left + dx;
        y = viewMap.position.top + dy;

        // disallow dragging beyond the borders
        if (x < 0) {
          x = 0;
        }
        else if ((x + itemFrame.width) > thisFrame.width) {
          x = thisFrame.width - itemFrame.width;
        }
      
        if (y < 0) {
          y = 0;
        }
        else if ((y + itemFrame.height) > thisFrame.height) {
          y = thisFrame.height - itemFrame.height;
        }

      // this._dragData.view.adjust({ left: x, top: y });
        viewMap.view.adjust({ left: x, top: y });
      });
      
      this.invokeOnce('updateCanvas'); // so that lines get redrawn
    }

    return YES;
  },

  mouseUp: function(evt) {
    var ret = sc_super();
    var layout, content, newPosition, action;
    
    if (this._dragData && this._dragData.didMove) {
      var self = this;
      this._dragData.selectedViews.forEach(function(viewMap){
        layout = viewMap.view.get('layout');
        content = viewMap.view.get('content');

        if (content && content.get('isNode')) {
          newPosition = { x: layout.left, y: layout.top };
          self._setItemPosition(content, newPosition);
        }
      });
      
    }

    this._dragData = null; // clean up

    if (evt && (evt.which === 3) || (evt.ctrlKey && evt.which === 1)) {
      action = this.get('contextMenuAction');

      if (action) {
        this.getPath('pane.rootResponder').sendAction(action, this.get('contextMenuTarget'), this, this.get('pane'), evt);
      }
    }
    
    return ret;
  },

  selectObjects: function(links) {
    this.set('selectedLinks', links.slice());
    this.linksDidChange();
  },

  // PRIVATE METHODS
  
  _layoutForNodeView: function(nodeView, node) {
    var layout = null, position, frame;

    if (nodeView && node) {
      frame = nodeView.get('frame');
      position = this._getItemPosition(node);

      // generate a random position if it's not present
      if (!position) {
        position = this._genRandomPosition();
        this._setItemPosition(node, position);
      }

      layout = { top: position.x, left: position.y, width: frame.width, height: frame.height };
    }
    return layout;
  },
  
  _updateLinks: function() {
    //console.log('%@._updateLinks()'.fmt(this));
    // N.B. This is notably different from master
    var links = [];
    var nodes = this.get('content');
    if (nodes) {
      var nodeLinks, key;
      // Get links from nodes
      nodes.forEach( function (currentNode) {
        if (currentNode && (key = currentNode.get('linksKey'))) {
          nodeLinks = currentNode.get(key) || [];
          links = links.concat(nodeLinks);
        }
      });
      // de-duplicate links array
      var tempArray = [];
      o:for(var i=0; i<links.length; i++) {
        for (var j=0; j<tempArray.length; j++) {
          if(tempArray[j]==links[i]) {
            continue o;
          }
        }
        tempArray[tempArray.length] = links[i];
      }
      links = tempArray;

      // Note that linkSelection ends up as the last selected link
      var linkSelection = this.get('linkSelection');
      var selectedLinks = this.get('selectedLinks');
      this.set('linkSelection', null);
      this.set('selectedLinks', []);
      var thisCanvas = this; // we'll need to refer to this deeper in
      selectedLinks.forEach( function (currentLink) {
        linkSelection = currentLink;
        var selectedID = LinkIt.genLinkID(linkSelection);
        links.forEach( function (link) {
          if ((LinkIt.genLinkID(link) === selectedID) && (thisCanvas.get('selectedLinks').indexOf(link) < 0)) {
            // if this was previously selected and isn't already in the array, we need to reselect it
            thisCanvas.set('linkSelection', link);
            link.set('isSelected', YES);
            thisCanvas.get('selectedLinks').pushObject(link);
          }
        });
      });
    }
    this.set('links', links);
    this.updateCanvas();
  },

  /**
  */
  _drawLinks: function(context) {
    var links = this._links;
    var numLinks = links.get('length');
    var link, points, i, linkID;
    for (i = 0; i < numLinks; i++) {
      link = links.objectAt(i);
      if (!SC.none(link)) {
        points = this._endpointsFor(link);
        if (points) {
          link.drawLink(context);
        }
      }
    }
  },
  
  _endpointsFor: function(link) {
    var startTerminal = this._terminalViewFor(link.get('startNode'), link.get('startTerminal'));
    var endTerminal = this._terminalViewFor(link.get('endNode'), link.get('endTerminal'));
    var startPt = null, endPt = null, pv, frame;
    
    if (startTerminal && endTerminal) {
      pv = startTerminal.get('parentView');
      if (pv) {
        frame = pv.convertFrameToView(startTerminal.get('frame'), this);
        startPt = {};
        startPt.x = SC.midX(frame); startPt.y = SC.midY(frame);
        link.set('startPt', startPt);
      }
    
      // Second Find the End
      pv = endTerminal.get('parentView');
      if (pv) {
        frame = pv.convertFrameToView(endTerminal.get('frame'), this);
        endPt = {};
        endPt.x = SC.midX(frame); endPt.y = SC.midY(frame);
        link.set('endPt', endPt);
      }

      var linkStyle = startTerminal.get('linkStyle');
      var oldValue = {};
      if (linkStyle) {
        oldValue = link.get('linkStyle') || {};
        link.set('linkStyle', SC.supplement(linkStyle,oldValue));
      }
      var label = startTerminal.get('label');
      if (label) {
        oldValue = link.get('label') || {};
        link.set('label', SC.supplement(label,oldValue));
      }
    }
    return startPt && endPt ? { startPt: startPt, endPt: endPt } : null;
  },
  
  /**
    pt = mouse click location { x: , y: } in canvas frame space
  */
  _selectLink: function(pt, append) {
    //console.log('%@._selectLink()'.fmt(this));
    var links = this._links || [];
    var len = links.get('length');
    var link, dist, i;
    var newSelectedLinks;

    // we compare distances squared to avoid costly square root calculations when finding distances
    var maxDist = (this.LINE_SELECTION_FREEDOM * this.LINE_SELECTION_FREEDOM) || 25;

    this.set('linkSelection', null);
    if (!append) this.set('selectedLinks', []);
    for (i = 0; i < len; i++) {
      link = links.objectAt(i);
      dist = link.distanceSquaredFromLine(pt);
      if ((SC.typeOf(dist) === SC.T_NUMBER) && (dist <= maxDist)) {
        if (append) {
          if (this.get('selectedLinks').indexOf(link) == -1) {  // not already selected
            link.set('isSelected', YES);
            this.set('linkSelection', link);
            // this.get('selectedLinks').pushObject(link); <-- this doesn't seem to trigger property observers
            newSelectedLinks = this.get('selectedLinks').slice();
            newSelectedLinks.pushObject(link);
            this.set('selectedLinks', newSelectedLinks);
          } else { // it's already there, remove it
            link.set('isSelected', NO);
            this.set('linkSelection', null);
            newSelectedLinks = this.get('selectedLinks').slice();
            newSelectedLinks.removeObject(link);
            this.set('selectedLinks', newSelectedLinks);
          }
        } else {
          link.set('isSelected', YES);
          this.set('linkSelection', link);
          this.set('selectedLinks', [link]);
        }
        break;
      }
      else {
        if (! append) link.set('isSelected', NO);
      }
    }

    // no more lines to select, just mark all the other lines as not selected
    if (!append) {
      for (i = i + 1; i < len; i++) {
        link = links.objectAt(i);
        link.set('isSelected', NO);
      }
    }

    // trigger a redraw of the canvas
    this.invokeOnce('updateCanvas');
  },
  
  _terminalViewFor: function(node, terminal) {
    var nodeView = this._nodeViewIndex[SC.guidFor(node)];
    if (nodeView && nodeView.terminalViewFor) {
      return nodeView.terminalViewFor(terminal);
    }
    return null;
  },

  _handleContentDidChange: function() {
    this._nodeSetup();
    this.linksDidChange(); // schedules a links update at the end of the run loop
  },
  
  /**
  */
  _contentDidChange: function() {
    this.invokeOnce('_handleContentDidChange');
  }.observes('*content.[]'), // without the '*' at the beginning, this doesn't get triggered
  
  _nodeSetup: function(){
    var nodes = this.get('content');
    var numNodes = 0;
    var node, nodeID;
    this._nodeIndex = this._nodeIndex || {};
    if (nodes) {
      numNodes = nodes.get('length');
      for (var i = 0; i < numNodes; i++) {
        node = nodes.objectAt(i);
        nodeID =  SC.guidFor(node);
        if (SC.none(this._nodeIndex[nodeID])){
          node.registerInvalidationDelegate(this, 'linksDidChange');
          this._nodeIndex[nodeID] = node;
        } 
      }
    }

    // Update the canvas state
    this.set('isEmpty', numNodes <= 0);
  },
  
  /**
    Encapsulates the standard way the dashboard attempts to extract the last
    position from the dashboard element.
    Returns null if unsuccessful.
  */
  _getItemPosition: function(item) {
    var posKey = item ? item.get('positionKey') : null;
    var pos = posKey ? item.get(posKey) : null;

    if (posKey && pos) {
      pos = { x: (parseFloat(pos.x) || 0), y: (parseFloat(pos.y) || 0) };
    }
    
    return pos;
  },
  
  /**
    Encapsulates the standard way the dashboard attempts to store the last
    position on a dashboard element.
  */
  _setItemPosition: function(item, pos) {
    var posKey = item ? item.get('positionKey') : null;

    if (posKey) {
      item.set(posKey, pos);
    }
  },
  
  /**
    Generates a random (x,y) where x=[10, 600), y=[10, 400)
  */
  _genRandomPosition: function() {
    return {
      x: Math.floor(10 + Math.random() * 590),
      y: Math.floor(10 + Math.random() * 390)
    };
  },
  
  // PRIVATE PROPERTIES
  
  /**
  */
  links: [],

  _nodeIndex: {},
  _nodeViewIndex: {},
  
  /**
    @private: parameters
  */
  _dragData: null,
  
  _canvasContext: null
  
});

